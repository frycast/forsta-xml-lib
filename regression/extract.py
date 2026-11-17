"""Read-only Forsta XML extraction. Python standard library; never resolves entities."""
import hashlib
import json
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from xml.parsers import expat


class Element:
    def __init__(self, tag, attrs, path, line):
        self.tag, self.attrs, self.path, self.line = tag, attrs, path, line
        self.children, self.parts = [], []

    @property
    def text(self):
        return ''.join(self.parts)

    def child(self, tag):
        return next((c for c in self.children if c.tag == tag), None)

    def value(self, tag):
        c = self.child(tag)
        return c.text if c else ''


def parse(data):
    parser = expat.ParserCreate()
    stack, roots = [], []

    def start(tag, attrs):
        siblings = stack[-1].children if stack else roots
        index = 1 + sum(c.tag == tag for c in siblings)
        path = (stack[-1].path if stack else '') + f'/{tag}[{index}]'
        node = Element(tag, attrs, path, parser.CurrentLineNumber)
        siblings.append(node)
        stack.append(node)

    def text(value):
        if stack:
            stack[-1].parts.append(value)

    def reject(*_):
        raise ValueError('DTD and external entities are not supported')

    parser.StartElementHandler = start
    parser.EndElementHandler = lambda _: stack.pop()
    parser.CharacterDataHandler = text
    parser.StartDoctypeDeclHandler = reject
    parser.ExternalEntityRefHandler = reject
    parser.Parse(data, True)
    if len(roots) != 1 or roots[0].tag != 'Project':
        raise ValueError('Expected an unnamespaced Forsta Project export')
    return roots[0]


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active, self.scripts, self.external = None, [], 0

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            attrs = dict(attrs)
            if attrs.get('src'):
                self.external += 1
            self.active = []

    def handle_data(self, value):
        if self.active is not None:
            self.active.append(value)

    def handle_endtag(self, tag):
        if tag == 'script' and self.active is not None:
            self.scripts.append(''.join(self.active))
            self.active = None


CODE = {
    'ScriptCode': ('server', 'script'),
    'ValidationCode': ('server', 'validation'),
    'Expression': ('server', 'expression'),
    'QuestionMask': ('server', 'expression'),
    'PrecodeMask': ('server', 'expression'),
    'ScalePrecodeMask': ('server', 'expression'),
    'ColumnMask': ('server', 'expression'),
    'StartupScript': ('browser', 'script'),
    'GlobalQuestionValidationCode': ('server', 'validation'),
}
ROUTE_TAGS = {'Script', 'Condition', 'Folder', 'Page', 'Stop', 'Note', 'Info',
              'Open', 'Single', 'Multi', 'Grid', 'Grid3D', 'Loop', 'CallBlock',
              'Telephone', 'Directive', 'Email', 'FileUpload', 'InlineBlock'}
CONTAINERS = {'Nodes', 'TrueNodes', 'FalseNodes'}


def extract(path):
    data = Path(path).read_bytes()
    root = parse(data)
    project = root.child('ProjectInfo')
    if project is None:
        raise ValueError('Missing ProjectInfo')
    blocks, nodes, ignored = [], [], Counter()

    def add(node, owner, kind, code, suffix='', environment=None):
        if not code.strip():
            return
        env, mode = CODE.get(kind, ('browser', 'script'))
        blocks.append({
            'key': node.path + suffix, 'entity': owner.attrs.get('EntityId', ''),
            'name': owner.value('Name'), 'ownerTag': owner.tag, 'kind': kind,
            'environment': environment or env, 'mode': mode,
            'line': node.line, 'code': code,
            'sha256': hashlib.sha256(code.encode()).hexdigest(),
        })

    def walk(node, owner):
        if node.attrs.get('EntityId') and node.tag not in CONTAINERS:
            owner = node
        if node.tag in CODE:
            add(node, owner, node.tag, node.text)
        for key in CODE:
            if key in node.attrs:
                add(node, owner, key, node.attrs[key], '/@' + key)
        if node.tag not in CODE and '<script' in node.text.lower():
            html = Scripts()
            html.feed(node.text)
            for i, code in enumerate(html.scripts):
                add(node, owner, 'InlineBrowserScript', code, f'/script[{i+1}]')
            ignored['externalBrowserScripts'] += html.external
        if '^' in node.text and node.tag not in CODE:
            ignored['textSurfacesWithCarets'] += 1
        if node.tag in ROUTE_TAGS:
            predicate = node.child('Predicate')
            structured = predicate is not None and any(c.children for c in predicate.children)
            nodes.append({
                'key': node.path, 'entity': node.attrs.get('EntityId', ''),
                'name': node.value('Name'), 'tag': node.tag, 'line': node.line,
                'attrs': {k: v for k, v in node.attrs.items()
                          if k in ('ElseEnabled', 'StopType', 'ITS', 'VariableType')},
                'structuredPredicate': structured,
                'children': {c.tag: [n.path for n in c.children]
                             for c in node.children if c.tag in CONTAINERS},
            })
        for child in node.children:
            walk(child, owner)

    walk(root, root)
    return {
        'file': Path(path).as_posix(), 'sha256': hashlib.sha256(data).hexdigest(),
        'projectId': project.attrs.get('ProjectId'), 'name': project.attrs.get('Name'),
        'language': project.attrs.get('ScriptCodeType'),
        'blocks': blocks, 'nodes': nodes, 'unexecutedSurfaces': dict(ignored),
    }


if __name__ == '__main__':
    try:
        json.dump([extract(path) for path in sys.argv[1:]], sys.stdout, ensure_ascii=True)
    except (OSError, ValueError, expat.ExpatError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
