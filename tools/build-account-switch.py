"""Bundle the server-storage account switcher without runtime external dependencies."""
from pathlib import Path
import argparse

def build(root):
    client = (root / "assets/account-vault-client.js").read_text(encoding="utf-8")
    client = client.split("if (typeof module !== 'undefined' && module.exports)")[0].rstrip()
    shell = (root / "assets/account-switch-shell.js").read_text(encoding="utf-8")
    marker = "  /* ACCOUNT_VAULT_CLIENT */"
    if shell.count(marker) != 1:
        raise RuntimeError("Expected one inline client marker")
    return shell.replace(marker, client)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    target = root / "Arena-Account-Switch.user.js"
    result = build(root)
    if args.check:
        if target.read_text(encoding="utf-8") != result:
            raise SystemExit("Account switch bundle is stale")
        print("Account switch bundle matches sources")
    else:
        target.write_text(result, encoding="utf-8", newline="\n")
        print("Generated", target.name)
