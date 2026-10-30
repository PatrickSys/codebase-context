#!/usr/bin/env python3
"""Aider RepoMap lane for the niche prior-art benchmark."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time


def tokenize(text: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[A-Za-z_][A-Za-z0-9_+#.-]{2,}", text)
        if token.lower()
        not in {"the", "and", "for", "with", "from", "that", "this", "what", "how", "does", "are"}
    ]


def git_tracked_files(root: str) -> list[str]:
    output = subprocess.check_output(["git", "ls-files"], cwd=root, text=True)
    return [line.strip() for line in output.splitlines() if line.strip()]


def ranked_files(root: str, query: str, limit: int) -> tuple[list[str], str, float]:
    from aider.io import InputOutput
    from aider.models import Model
    from aider.repomap import RepoMap

    started = time.time()
    io = InputOutput(yes=True)
    model = Model("gpt-4o-mini")
    repo_map = RepoMap(map_tokens=4096, root=root, main_model=model, io=io)
    tracked = git_tracked_files(root)
    source_files = [
        path
        for path in tracked
        if any(
            path.endswith(ext)
            for ext in (".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".cs", ".cpp", ".c", ".h")
        )
    ]
    mentioned = tokenize(query)
    tags = repo_map.get_ranked_tags([], source_files, [], mentioned)
    top_files: list[str] = []
    for tag in tags:
        rel = getattr(tag, "rel_fname", None) or getattr(tag, "fname", None)
        if not isinstance(rel, str):
            continue
        normalized = rel.replace("\\", "/").lstrip("./")
        if normalized and normalized not in top_files:
            top_files.append(normalized)
        if len(top_files) >= limit:
            break
    payload = json.dumps(
        {"mentionedIdents": mentioned, "rankedTags": len(tags), "topFiles": top_files},
        indent=2,
    )
    return top_files, payload, (time.time() - started) * 1000


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--query", default="")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--warm-index", action="store_true")
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(os.path.join(root, ".git")):
        print(json.dumps({"error": "missing_git_metadata", "topFiles": [], "payload": ""}))
        return 2

    try:
        if args.warm_index:
            _, _, elapsed_ms = ranked_files(root, "warm index scan", min(args.limit, 3))
            print(json.dumps({"status": "indexed", "indexElapsedMs": elapsed_ms}))
            return 0

        top_files, payload, elapsed_ms = ranked_files(root, args.query, args.limit)
        print(
            json.dumps(
                {
                    "topFiles": top_files,
                    "payload": payload,
                    "queryElapsedMs": elapsed_ms,
                    "indexElapsedMs": 0,
                }
            )
        )
        return 0
    except Exception as exc:  # noqa: BLE001 - benchmark boundary
        print(json.dumps({"error": str(exc), "topFiles": [], "payload": ""}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
