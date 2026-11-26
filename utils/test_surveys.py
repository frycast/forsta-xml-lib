import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import xml.etree.ElementTree as ET

import surveys


def export(created="2026-10-01T00:00:00Z", job="3522RL", version=None):
    project = ET.Element("Project")
    info = ET.SubElement(project, "ProjectInfo", ProjectId="p123", Name="[LIVE] 3471 - Study", CreatedDate=created)
    fields = ET.SubElement(info, "SurveyFields")
    values = {"LinA_flag": "Y", "src_job_id": job}
    if version is not None:
        values["shell_version"] = version
    for name, value in values.items():
        ET.SubElement(fields, "SurveyField", Name=name, Value=value)
    return project


class SurveyCLI(unittest.TestCase):
    def test_order_filters_and_ties(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "nested").mkdir()
            for name, time in [
                ("nested/z", "2026-10-01T01:00:00.0000001+01:00"),
                ("a", "2026-10-01T00:00:00.00000010Z"),
                ("b", "2026-10-01T00:00:00.0000002Z"),
                ("c", "2026-10-01T00:01:00+01:00"),
                ("d", "2026-10-02T00:00:00Z"),
            ]:
                ET.ElementTree(export(time)).write(root / f"{name}.xml")
            args = [sys.executable, surveys.__file__, "list", "--root", tmp, "--since", "2026-10-01", "--before", "2026-10-02"]
            rows = json.loads(subprocess.check_output([*args, "--json"]))
            self.assertEqual([r["path"] for r in rows], ["b.xml", "a.xml", "nested/z.xml"])
            self.assertEqual(subprocess.check_output([*args, "--oldest-first", "--limit", "1"], text=True), "a.xml\n")
            ET.ElementTree(export("bad")).write(root / "bad.xml")
            failure = subprocess.run(args, capture_output=True, text=True)
            self.assertNotEqual(failure.returncode, 0)
            self.assertFalse(failure.stdout)
            self.assertIn("bad.xml", failure.stderr)

    def test_metadata(self):
        info = export(job="", version="1.2").find("ProjectInfo")
        self.assertEqual(surveys.destination(info).as_posix(), "lina_shell/shell-1.2/3471-p123.xml")
        fields = info.find("SurveyFields")
        fields.find("SurveyField[@Name='LinA_flag']").set("Value", "N")
        self.assertEqual(surveys.destination(info).parts[0], "src_shell")
        for name, value in [("shell_version", ""), ("shell_version", "../x"), ("LinA_flag", "?")]:
            field = fields.find(f"SurveyField[@Name='{name}']")
            original = field.get("Value")
            field.set("Value", value)
            with self.assertRaises(ValueError):
                surveys.destination(info)
            field.set("Value", original)
        ET.SubElement(fields, "SurveyField", Name="src_job_id", Value="9999")
        with self.assertRaises(ValueError):
            surveys.destination(info)

    @unittest.skipUnless(shutil.which("bun") and shutil.which("betterleaks"), "requires Bun and Betterleaks 1.9.x")
    def test_real_redactor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = root / "input.xml"
            project = export(version="1.2")
            fields = project.find("./ProjectInfo/SurveyFields")
            ET.SubElement(fields, "SurveyField", Name="password", Value="synthetic-test-password")
            ET.ElementTree(project).write(original)
            library = root / "library"
            with patch.object(surveys, "SURVEYS", library), contextlib.redirect_stdout(io.StringIO()):
                surveys.store(SimpleNamespace(input=original, betterleaks=None))
            target = library / "lina_shell/shell-1.2/3522RL-p123.xml"
            query = "./ProjectInfo/SurveyFields/SurveyField[@Name='password']"
            self.assertEqual(ET.parse(target).find(query).get("Value"), "redacted")
            self.assertEqual(ET.parse(original).find(query).get("Value"), "synthetic-test-password")

    def test_store_uses_only_successful_redactor_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            inbox.mkdir()
            original = inbox / "incoming.xml"
            original.write_text("synthetic raw input")
            library = Path(tmp) / "surveys"
            output = inbox / "redact-secrets-output"
            output.mkdir()
            cleaned = output / original.name
            ET.ElementTree(export()).write(cleaned)
            target = library / "lina_shell/shell-0/3522RL-p123.xml"
            args = SimpleNamespace(input=original, betterleaks=None)
            with patch.object(surveys, "SURVEYS", library), patch("shutil.which", return_value="bun"), patch("subprocess.run") as redact, contextlib.redirect_stdout(io.StringIO()):
                redact.side_effect = subprocess.CalledProcessError(1, "redactor")
                with self.assertRaises(subprocess.CalledProcessError):
                    surveys.store(args)
                self.assertFalse(library.exists())
                redact.side_effect = None
                surveys.store(args)
                redact.assert_called_with(["bun", str(surveys.REDACTOR), "--", str(original)], stdout=sys.stderr, check=True)
                self.assertEqual(target.read_bytes(), cleaned.read_bytes())
                surveys.store(args)
                target.write_text("keep existing")
                self.assertEqual(surveys.store(args), 3)
                self.assertEqual(target.read_text(), "keep existing")
                self.assertEqual(original.read_text(), "synthetic raw input")

    def test_review_then_resume_mixed_decisions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            output = root / "redact-secrets-output"
            output.mkdir()
            library = root / "library"
            names = ["1001.xml", "1002.xml", "1003.xml"]
            targets = []
            for name in names:
                project = export(job=Path(name).stem)
                ET.ElementTree(project).write(output / name)
                target = library / surveys.destination(project.find("ProjectInfo"))
                targets.append(target)
            targets[0].parent.mkdir(parents=True)
            for target in targets[:2]:
                target.write_text("previous")
            report = {"files_processed": 3, "files": [{"filename": n} for n in names]}
            (output / "redaction-report.json").write_text(json.dumps(report))
            paths = [t.relative_to(library).as_posix() for t in targets]
            args = SimpleNamespace(output=output, review=None, keep_all=False, replace_all=False, replace=None)
            def run():
                with contextlib.redirect_stdout(io.StringIO()) as stdout:
                    status = surveys.resume(args)
                return status, stdout.getvalue()
            with patch.object(surveys, "SURVEYS", library):
                status, message = run()
                self.assertEqual(status, 3)
                review = json.loads(message)
                self.assertEqual(review["conflicts"], paths[:2])
                args.review, args.replace = review["review"], [paths[1]]
                for changed in (targets[0], output / names[1]):
                    with changed.open("ab") as stream:
                        stream.write(b" ")
                    status, message = run()
                    self.assertEqual(status, 3)
                    self.assertFalse(targets[2].exists())
                    args.review = json.loads(message)["review"]
                self.assertEqual(run()[0], 0)
                self.assertEqual(targets[0].read_text(), "previous ")
                for target, name in zip(targets[1:], names[1:]):
                    self.assertEqual(target.read_bytes(), (output / name).read_bytes())
                args.review, args.replace = None, None
                status, message = run()
                self.assertEqual(status, 3)
                self.assertEqual(json.loads(message)["conflicts"], paths[:1])
                args.review, args.keep_all = json.loads(message)["review"], True
                self.assertEqual(run()[0], 0)
                self.assertEqual(targets[0].read_text(), "previous ")
                args.keep_all, args.replace_all = False, True
                self.assertEqual(run()[0], 0)
                self.assertEqual(targets[0].read_bytes(), (output / names[0]).read_bytes())


if __name__ == "__main__":
    unittest.main()
