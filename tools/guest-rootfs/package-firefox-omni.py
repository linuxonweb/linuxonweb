"""Pack a flat Firefox runtime using its own source tree's OmniJar formatter."""

from pathlib import Path
import stat
import sys


def pack_resources(source, destination, moz_source):
    source = Path(source)
    destination = Path(destination)
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Source must be a real flat runtime directory')
    if destination.exists() or destination.is_symlink():
        raise ValueError('Destination must not exist')
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError('Source and destination must not overlap')
    if not destination.parent.is_dir():
        raise ValueError('Destination parent must exist')
    inputs = []
    for path in sorted(source.rglob('*')):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise ValueError('Flat runtime must contain only regular files: ' + str(path))
        if path.name == 'omni.ja':
            raise ValueError('Runtime is already packed')
        inputs.append(path)
    if not (source / 'chrome.manifest').is_file() or not (source / 'browser/chrome.manifest').is_file():
        raise ValueError('Both toolkit and browser resource manifests are required')
    moz_source = Path(moz_source).resolve(strict=True)
    python_root = moz_source / 'python/mozbuild'
    packaging_root = moz_source / 'third_party/python/packaging'
    if not (python_root / 'mozpack/packager/formats.py').is_file():
        raise ValueError('Firefox source lacks the OmniJar packager')
    if not (packaging_root / 'packaging/version.py').is_file():
        raise ValueError('Firefox source lacks its vendored packaging dependency')
    for name, root in [('mozpack', python_root), ('mozbuild', python_root), ('packaging', packaging_root)]:
        loaded = sys.modules.get(name)
        if loaded and not Path(loaded.__file__).resolve().is_relative_to(root):
            raise ValueError('A different Firefox packager is already imported')
    sys.path[:0] = [str(python_root), str(packaging_root)]
    from mozpack.copier import FileCopier
    from mozpack.files import File
    from mozpack.packager import SimplePackager
    from mozpack.packager.formats import OmniJarFormatter

    copier = FileCopier()
    packager = SimplePackager(OmniJarFormatter(copier, 'omni.ja', compress=True))
    for path in inputs:
        packager.add(path.relative_to(source).as_posix(), File(str(path)))
    packager.close()
    destination.mkdir(mode=0o700)
    copier.copy(str(destination), skip_if_older=False, remove_unaccounted=False,
                remove_all_directory_symlinks=False, remove_empty_directories=False)
    outputs = [path for path in destination.rglob('*') if path.is_file()]
    return {
        'sourceFiles': len(inputs),
        'outputFiles': len(outputs),
        'sourcePageBytes': sum(((path.stat().st_size + 65535) // 65536) * 65536 for path in inputs),
        'outputPageBytes': sum(((path.stat().st_size + 65535) // 65536) * 65536 for path in outputs),
        'pageBytes': 65536,
        'runtimeAcceptance': False,
    }
