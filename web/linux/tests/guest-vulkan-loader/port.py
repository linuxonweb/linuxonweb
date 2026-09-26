"""Small source-guarded port applied only to the frozen upstream build copy."""
import difflib
import re

def replace_body(source, signature, body):
    if source.count(signature) != 1:
        raise ValueError('port signature changed: ' + signature)
    start = source.index('{', source.index(signature))
    # Preserve braces inside quoted strings/comments as inert lexical content.
    token = re.compile(r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[{}]', re.S)
    depth = 0
    for match in token.finditer(source, start):
        if match.group() == '{': depth += 1
        elif match.group() == '}':
            depth -= 1
            if not depth:
                return source[:start + 1] + '\n' + body.rstrip() + '\n' + source[match.start():]
    raise ValueError('unclosed function')

def apply_port(root, fixture, output):
    path = root / 'loader/loader.c'
    original = source = path.read_text()
    source = replace_body(source, 'VkResult loader_icd_scan(', (fixture / 'static-provider.inc').read_text())
    for signature in ('void loader_scan_for_layers(', 'void loader_scan_for_implicit_layers('):
        source = replace_body(source, signature,
            '    /* Static profile: no external layers or manifest/dlopen discovery. */\n'
            '    loader_delete_layer_list_and_properties(inst, instance_layers);\n'
            '    memset(instance_layers, 0, sizeof(*instance_layers));')
    old = '            loader_platform_close_library(icd_tramp_list->scanned_list[i].handle);'
    if source.count(old) != 1: raise ValueError('close guard anchor changed')
    source = source.replace(old, '            if (icd_tramp_list->scanned_list[i].handle)\n' + old + ' // Built-in provider owns no dl handle.')
    path.write_text(source)
    (output / 'static-loader-port.patch').write_text(''.join(difflib.unified_diff(
        original.splitlines(True),source.splitlines(True),fromfile='a/loader/loader.c',tofile='b/loader/loader.c')))
