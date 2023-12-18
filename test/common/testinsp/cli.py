import click
from pprint import pprint
from testinsp.main import RunChecks

checker = RunChecks()


@click.group()
def cli():
    pass


@cli.command()
def init():
    checker.init()
    checker.store()


@cli.command()
def check():
    checker.load()
    out = checker.check()
    pprint(out)


if __name__ == "__main__":
    cli()
