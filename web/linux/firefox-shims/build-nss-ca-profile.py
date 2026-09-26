#!/usr/bin/env python3
"""Create the Firefox guest's NSS SQL profile from its PEM CA bundle.

Usage: build-nss-ca-profile.py GUEST_CERT_PEM OUTPUT_DIR

The output is copied to /nss-ca-profile in the Firefox initramfs.  The
Wasm-only NSS fallback in patch 0004 recognizes the lowland-ca-* nicknames;
it still performs normal certificate chain and hostname verification.
"""

import argparse
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


GUEST_PROFILE = "/home/admin/.mozilla/firefox/http1-profile"
CERT_PATTERN = re.compile(
    rb"-----BEGIN CERTIFICATE-----\s+.*?-----END CERTIFICATE-----",
    re.DOTALL,
)


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("guest_cert_pem", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    if shutil.which("certutil") is None:
        parser.error("NSS certutil is required")
    certs = CERT_PATTERN.findall(args.guest_cert_pem.read_bytes())
    if not certs:
        parser.error("the guest CA bundle contains no PEM certificates")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if any(args.output_dir.iterdir()):
        parser.error("output directory must be empty")

    database = f"sql:{args.output_dir}"
    run("certutil", "-N", "-d", database, "--empty-password")
    with tempfile.TemporaryDirectory(prefix="lowland-nss-ca-") as tmp:
        certificate_file = Path(tmp) / "ca.pem"
        for number, certificate in enumerate(certs, 1):
            certificate_file.write_bytes(certificate + b"\n")
            run(
                "certutil", "-A", "-d", database,
                "-n", f"lowland-ca-{number:03d}", "-t", "C,,",
                "-i", str(certificate_file),
            )

    pkcs11 = args.output_dir / "pkcs11.txt"
    contents = pkcs11.read_text()
    contents = re.sub(r"configdir='sql:[^']*'", f"configdir='sql:{GUEST_PROFILE}'", contents)
    pkcs11.write_text(contents)
    print(f"Imported {len(certs)} CAs into {args.output_dir}; guest profile {GUEST_PROFILE}")


if __name__ == "__main__":
    main()
