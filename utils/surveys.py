"""Navigate and import Forsta XML exports. Requires Python 3.10+."""
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SURVEYS = ROOT / "surveys"
REDACTOR = ROOT / ".agents/skills/redact-secrets/scripts/redact-secrets.ts"


def project_info(path, *, header_only=False):
    # ProjectInfo precedes the questionnaire, which can be many megabytes.
    with path.open("rb") as stream:
        depth = 0
        for event, element in ET.iterparse(stream, events=("start", "end")):
            if event == "start":
                depth += 1
                if depth == 1 and element.tag != "Project":
                    break
            if depth == 2 and element.tag == "ProjectInfo":
                if event == "end" or header_only:
                    return element
            if event == "end":
                depth -= 1
    raise ValueError("missing Project/ProjectInfo")


def destination(info):
    fields = info.findall("./SurveyFields/SurveyField")

    def field(name, missing=None):
        values = [f.get("Value", "") for f in fields if f.get("Name") == name]
        if len(values) > 1:
            raise ValueError(f"duplicate {name}")
        return values[0] if values else missing

    job = field("src_job_id", "")
    if not re.fullmatch(r"[0-9]{4}[A-Za-z0-9]*", job):
        match = re.match(r"^(?:\[[^\]]+\]\s*)?([0-9]{4}[A-Za-z0-9]*)\b", info.get("Name", ""))
        if not match:
            raise ValueError("no usable src_job_id or leading job ID in project name")
        job = match[1]
    project = info.get("ProjectId", "")
    if not re.fullmatch(r"p[0-9]+", project):
        raise ValueError("invalid ProjectId")
    family = {"Y": "lina_shell", "N": "src_shell"}.get(field("LinA_flag"))
    if family is None:
        raise ValueError("LinA_flag must be Y or N")
    version = field("shell_version", "0")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", version):
        raise ValueError("invalid shell_version")
    return Path(family, f"shell-{version}", f"{job}-{project}.xml")


def utc_key(value):
    # Keep the fraction separate: datetime truncates Forsta's 100 ns ticks.
    match = re.fullmatch(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)", value)
    if not match:
        raise ValueError("expected an ISO CreatedDate with a UTC offset")
    offset = "+00:00" if match[3] == "Z" else match[3]
    second = datetime.fromisoformat(match[1] + offset).astimezone(timezone.utc)
    return second, (match[2] or "").rstrip("0")


def list_created(args):
    if not args.root.is_dir():
        raise ValueError(f"missing survey directory: {args.root}")
    rows = []
    for path in sorted(args.root.rglob("*"), key=lambda p: p.as_posix()):
        if path.suffix.lower() != ".xml" or not path.is_file():
            continue
        name = path.relative_to(args.root).as_posix()
        try:
            value = project_info(path, header_only=True).get("CreatedDate", "")
            key = utc_key(value)
        except (ValueError, ET.ParseError, OverflowError) as error:
            raise ValueError(f"{name}: invalid ProjectInfo/@CreatedDate ({error})") from error
        day = key[0].date()
        if (args.since is None or day >= args.since) and (args.before is None or day < args.before):
            rows.append((key, {"path": name, "created_date": value}))
    # Input paths are ascending. Stable sort preserves that order for tied instants.
    rows.sort(key=lambda row: row[0], reverse=not args.oldest_first)
    result = [row for _, row in rows[:args.limit]]
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for row in result:
            print(row["path"])


def digest(path):
    with path.open("rb") as stream:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def publish(source, target, incoming, existing, replace):
    target.parent.mkdir(parents=True, exist_ok=True)
    # Link a finished file on the destination filesystem, without overwriting
    # another process's import. Source and repository can be on different drives.
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as tmp:
        staged = Path(tmp.name)
    try:
        shutil.copyfile(source, staged)
        if digest(staged) != incoming:
            raise ValueError("redacted copy changed during filing; review the batch again")
        if replace:
            # Serialize replacements by concurrent wrapper processes.
            lock = target.with_suffix(".xml.replace-lock")
            lock.mkdir()
            try:
                if target.resolve() != target or digest(target) != existing:
                    raise ValueError(f"destination changed during filing; review again: {target}")
                os.replace(staged, target)
            finally:
                lock.rmdir()
            return
        try:
            os.link(staged, target)
        except FileExistsError:
            if target.is_symlink() or digest(target) != incoming:
                raise ValueError(f"destination already contains different content: {target}")
    finally:
        staged.unlink(missing_ok=True)


def store(args):
    source = args.input.absolute()
    if source.is_symlink() or not (source.is_dir() or source.is_file()):
        raise ValueError("supply an XML file or a directory of XML files")
    folder = source if source.is_dir() else source.parent
    if folder.resolve().is_relative_to(SURVEYS) and folder.resolve() != SURVEYS / "new/xml":
        raise ValueError("choose surveys/new/xml or an inbox outside surveys/")
    files = sorted(p for p in folder.iterdir() if p.is_file()) if source.is_dir() else [source]
    if not files or any(p.suffix.lower() != ".xml" or p.is_symlink() for p in files):
        raise ValueError("the input must contain only regular XML files")
    bun = shutil.which("bun")
    if not bun:
        raise ValueError("store requires Bun and Betterleaks 1.9.x")
    command = [bun, str(REDACTOR)]
    if args.betterleaks:
        command += ["--betterleaks", str(args.betterleaks.absolute())]
    subprocess.run([*command, "--", str(source)], stdout=sys.stderr, check=True)

    return file_batch(folder / "redact-secrets-output", [p.name for p in files])


def file_batch(output, names, *, review=False, approval=None, replace_all=False, replacements=()):
    if output.resolve() != output or output.name != "redact-secrets-output":
        raise ValueError("expected the redactor's regular output directory")
    planned = {}
    for name in names:
        if Path(name).name != name or Path(name).suffix.lower() != ".xml":
            raise ValueError("unexpected filename in redaction batch")
        redacted = output / name
        if redacted.resolve() != redacted or not redacted.is_file():
            raise ValueError(f"missing or linked redacted copy: {name}")
        try:
            target = SURVEYS / destination(project_info(redacted))
        except (ValueError, ET.ParseError) as error:
            raise ValueError(f"{name}: {error}") from error
        if target.resolve() != target or target in planned:
            raise ValueError(f"linked or duplicate destination: {target}")
        planned[target] = (name, digest(redacted), digest(target) if target.exists() else None)
    snapshot = {p.relative_to(SURVEYS).as_posix(): planned[p] for p in sorted(planned)}
    conflicts = [p for p, (_, incoming, existing) in snapshot.items()
                 if existing is not None and existing != incoming]
    token = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    if approval != token and (review or conflicts or approval is not None):
        print(json.dumps({"status": "review_required", "output": str(output), "review": token,
                          "total": len(snapshot), "conflicts": conflicts}, indent=2))
        return 3
    selected = set(conflicts if replace_all else replacements)
    if selected.difference(conflicts):
        raise ValueError("replacement selection includes a path outside the reviewed conflicts")
    for path, (name, incoming, existing) in snapshot.items():
        if path in conflicts and path not in selected:
            print(f"kept existing: {path}", file=sys.stderr)
            continue
        publish(output / name, SURVEYS / path, incoming, existing, path in selected)
        print(path)
    return 0


def resume(args):
    output = args.output.absolute()
    if output.name != "redact-secrets-output" or output.resolve() != output:
        raise ValueError("supply the completed redactor output directory")
    report = output / "redaction-report.json"
    if report.is_symlink():
        raise ValueError("linked redaction report")
    data = json.loads(report.read_text(encoding="utf-8"))
    names = [row["filename"] for row in data["files"]]
    if not names or len(names) != data["files_processed"] or len(set(names)) != len(names):
        raise ValueError("incomplete redaction report")
    if bool(args.review) != bool(args.keep_all or args.replace_all or args.replace):
        raise ValueError("supply the review token and one decision together")
    return file_batch(output, names, review=True, approval=args.review,
                      replace_all=args.replace_all, replacements=args.replace or ())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="list paths relative to surveys/ by ProjectInfo/@CreatedDate, newest first")
    listing.add_argument("--root", type=Path, default=SURVEYS, help="directory to search recursively (default: surveys/)")
    listing.add_argument("--since", type=date.fromisoformat, metavar="YYYY-MM-DD", help="include this UTC day and later")
    listing.add_argument("--before", type=date.fromisoformat, metavar="YYYY-MM-DD", help="exclude this UTC day and later")
    listing.add_argument("--oldest-first", action="store_true")
    listing.add_argument("--limit", type=int, metavar="N")
    listing.add_argument("--json", action="store_true", help="include original CreatedDate values")
    ingest = commands.add_parser("store", help="redact an external inbox, then store exports by XML metadata")
    ingest.add_argument("input", type=Path, help="UTF-8 XML file or flat directory of XML files")
    ingest.add_argument("--betterleaks", type=Path, help="path to Betterleaks 1.9.x (default: PATH)")
    pending = commands.add_parser("resume", help="review or file a completed redaction batch")
    pending.add_argument("output", type=Path)
    pending.add_argument("--review", help="token from the reviewed batch")
    choice = pending.add_mutually_exclusive_group()
    choice.add_argument("--keep-all", action="store_true", help="keep all conflicting library copies")
    choice.add_argument("--replace-all", action="store_true", help="replace all reviewed conflicts")
    choice.add_argument("--replace", action="append", metavar="PATH", help="replace this conflict (repeatable); keep other conflicts")
    args = parser.parse_args()
    if args.command == "list" and args.limit is not None and args.limit < 0:
        parser.error("--limit must be non-negative")
    try:
        return {"list": list_created, "store": store, "resume": resume}[args.command](args)
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    sys.exit(main())
