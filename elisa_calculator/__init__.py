"""ELISA calculator package with a lazy CLI entry point."""


def main(argv=None):
    # Avoid importing bridge during `python -m elisa_calculator.bridge` discovery.
    from .bridge import main as bridge_main
    return bridge_main(argv)


__all__ = ['main']
__version__ = '0.3.1'
