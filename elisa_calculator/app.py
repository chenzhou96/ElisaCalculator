"""Compatibility entrypoint that forwards to the JSON bridge CLI."""

from .bridge import main as bridge_main


def main(argv=None):
    return bridge_main(argv)


if __name__ == '__main__':
    raise SystemExit(main())
