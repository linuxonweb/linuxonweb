"""Scope the Linux/Wasm extension-document watchdog default to 60 seconds.

The original page, content-script and chrome budgets remain separate.  A
separate preference also keeps AlwaysContinueSlowScript local to this scope.
This adapter is shared by pristine-source preparation and retained-TU rebuilds.
"""

NATIVE_PREDICATE = "defined(__wasm__) && defined(__linux__) && !defined(__wasi__)"
PREFERENCE = "dom.max_ext_document_script_run_time"
DEFAULT_SECONDS = 60

ADAPTATIONS = [
    (
        '#define PREF_MAX_SCRIPT_RUN_TIME_EXT_CONTENT \\\n  "dom.max_ext_content_script_run_time"\n',
        '#define PREF_MAX_SCRIPT_RUN_TIME_EXT_CONTENT \\\n  "dom.max_ext_content_script_run_time"\n'
        '#if ' + NATIVE_PREDICATE + '\n'
        '#  define PREF_MAX_SCRIPT_RUN_TIME_EXT_DOCUMENT \\\n    "' + PREFERENCE + '"\n'
        'static constexpr int32_t kWasmExtensionDocumentScriptRunTimeSeconds = 60;\n'
        '#endif\n',
        'extension-document preference and finite default',
    ),
    (
        '    PREF_MAX_SCRIPT_RUN_TIME_EXT_CONTENT,\n    nullptr,\n',
        '    PREF_MAX_SCRIPT_RUN_TIME_EXT_CONTENT,\n'
        '#if ' + NATIVE_PREDICATE + '\n'
        '    PREF_MAX_SCRIPT_RUN_TIME_EXT_DOCUMENT,\n'
        '#endif\n'
        '    nullptr,\n',
        'watchdog preference callback',
    ),
    (
        '      mWatchdog->SetMinScriptRunTimeSeconds(\n'
        '          std::min({contentTime, chromeTime, extTime}));\n',
        '      int32_t minTime = std::min({contentTime, chromeTime, extTime});\n'
        '#if ' + NATIVE_PREDICATE + '\n'
        '      int32_t extDocumentTime = Preferences::GetInt(\n'
        '          PREF_MAX_SCRIPT_RUN_TIME_EXT_DOCUMENT,\n'
        '          kWasmExtensionDocumentScriptRunTimeSeconds);\n'
        '      if (extDocumentTime > 0) {\n'
        '        minTime = std::min(minTime, extDocumentTime);\n'
        '      }\n'
        '#endif\n'
        '      mWatchdog->SetMinScriptRunTimeSeconds(minTime);\n',
        'watchdog minimum includes extension-document budget',
    ),
    (
        '    limit = StaticPrefs::dom_max_ext_content_script_run_time();\n'
        '  } else {\n',
        '    limit = StaticPrefs::dom_max_ext_content_script_run_time();\n'
        '#if ' + NATIVE_PREDICATE + '\n'
        '  } else if (principal->AddonPolicy()) {\n'
        '    // Extension documents need a separate budget on Linux/Wasm.\n'
        '    // Expanded content-script principals were handled above.\n'
        '    prefName = PREF_MAX_SCRIPT_RUN_TIME_EXT_DOCUMENT;\n'
        '    limit = Preferences::GetInt(\n'
        '        prefName, kWasmExtensionDocumentScriptRunTimeSeconds);\n'
        '#endif\n'
        '  } else {\n',
        'extension-document principal classification',
    ),
]


def adapt_xpc(text):
    """Apply exact known anchors, accepting only a complete prior application."""
    applied = [text.count(new) == 1 for _, new, _ in ADAPTATIONS]
    if all(applied):
        return text
    if any(applied) or PREFERENCE in text:
        raise ValueError("Partial or changed extension-document watchdog adaptation")
    for old, new, name in ADAPTATIONS:
        count = text.count(old)
        if count != 1:
            raise ValueError(f"{name}: expected one source anchor, found {count}")
        text = text.replace(old, new, 1)
    return text
