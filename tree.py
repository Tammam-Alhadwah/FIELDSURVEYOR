import os
from pathlib import Path

# =============================
# CONFIG — OPINIONATED ON PURPOSE
# =============================

IGNORE_DIRS = {
    '.git', '__pycache__', '.venv', 'env', '.idea', '.vscode',
    'node_modules', 'build', 'dist', '.next', '.cache', "auth"
}

IGNORE_FILES = {
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'tree.py',
    '.env'
}

SKIP_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.ico',
    '.pdf', '.zip', '.tar', '.gz',
    '.exe', '.dll', '.so', '.bin', '.pyc'
}

MAX_FILE_SIZE = 300 * 1024  # 300KB — beyond this is usually junk/logs

# =============================
# CORE LOGIC
# =============================

def emit_project_snapshot(root: Path, prefix=""):
    try:
        entries = sorted(
            [e for e in root.iterdir()
             if not (
                (e.is_dir() and e.name in IGNORE_DIRS) or
                (e.is_file() and e.name in IGNORE_FILES)
             )],
            key=lambda x: (not x.is_dir(), x.name.lower())
        )

        for idx, entry in enumerate(entries):
            is_last = idx == len(entries) - 1
            connector = "└── " if is_last else "├── "
            print(f"{prefix}{connector}{entry.name}")

            if entry.is_dir():
                extension = "    " if is_last else "│   "
                emit_project_snapshot(entry, prefix + extension)
            else:
                emit_file(entry, prefix + ("    " if is_last else "│   "))

    except PermissionError:
        print(f"{prefix}[ACCESS DENIED]")


def emit_file(file_path: Path, indent: str):
    if file_path.suffix.lower() in SKIP_EXTENSIONS:
        print(f"{indent}[skipped binary]")
        return

    try:
        if file_path.stat().st_size > MAX_FILE_SIZE:
            print(f"{indent}[skipped large file]")
            return
    except OSError:
        print(f"{indent}[stat error]")
        return

    print(f"{indent}{'-' * 50}")
    print(f"{indent}FILE: {file_path}")
    print(f"{indent}{'-' * 50}")

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                print(f"{indent}{line.rstrip()}")
    except Exception as e:
        print(f"{indent}[read error: {e}]")


# =============================
# ENTRY POINT
# =============================

if __name__ == "__main__":
    root = Path.cwd()
    print(f"\nPROJECT SNAPSHOT: {root.name}")
    print(f"ROOT: {root}\n")
    emit_project_snapshot(root)
    print("\n--- END OF SNAPSHOT ---")
