import argparse
import tqdm
from pathlib import Path

import prepre.parse as parse




def _parse_data(args):
    filename = Path(args.input_file)
    output_dir = Path(args.output_dir)

    parse.parse(filename, output_dir, args.model)



if __name__ == "__main__":

    parent_parser = argparse.ArgumentParser(add_help=False)

    root_parser = argparse.ArgumentParser(prog='prepre', add_help=True)
    # root_parser.set_defaults(func=)
    subparsers = root_parser.add_subparsers(title="actions", dest="actions")


    parser_parsedata = subparsers.add_parser('parse', parents=[parent_parser],
                                             description='run NLP Pipeline',
                                             help='run NLP Pipeline')
    parser_parsedata.add_argument("-m", "--model", choices=["ja_core_news_trf", "es_core_news_lg", "en_core_web_trf"], required=True)
    parser_parsedata.add_argument("-i", "--input-file", required=True)
    parser_parsedata.add_argument("-o", "--output-dir", required=True)
    parser_parsedata.set_defaults(func=_parse_data)

    args = root_parser.parse_args()

    if "func" not in args:
        root_parser.print_usage()
        exit()

    args.func(args)