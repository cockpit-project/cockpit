#!/usr/bin/python3
# export uReport_URL="http://localhost:12345"

import email
import email.parser
import email.policy
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST_attach(self):
        self.wfile.write(json.dumps({'result': True}).encode())

    def do_POST_new(self):
        response = {
            'bthash': '123deadbeef',
            'message': 'http://localhost:12345/reports/42/\nhttps://bugzilla.example.com/show_bug.cgi?id=123456',
            'reported_to': [
                {
                    'type': 'url',
                    'value': 'http://localhost:12345/reports/42/',
                    'reporter': 'ABRT Server'
                },
                {
                    'type': 'url',
                    'value': 'https://bugzilla.example.com/show_bug.cgi?id=123456',
                    'reporter': 'Bugzilla'
                }
            ],
            'result': False
        }
        self.wfile.write(json.dumps(response, indent=2).encode())

    def do_POST(self):
        content_length = int(self.headers.get('content-length', 0))
        data = self.rfile.read(content_length)

        # Without the cgi module, we need to massage the data to form a valid message
        p = email.parser.BytesFeedParser(policy=email.policy.HTTP)
        p.feed('Content-Type: {}\r\n'.format(self.headers.get('content-type', '')).encode())
        p.feed('\r\n'.encode())
        p.feed(data)
        m = p.close()

        assert m.is_multipart(), "not a multipart message"
        parts = list(m.iter_parts())
        json_str = parts[0].get_payload()

        self.send_response(202)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Connection', 'close')
        self.end_headers()

        try:
            # just check that it's a JSON
            json.loads(json_str)
        except ValueError:
            sys.stderr.write(f'Received invalid JSON data:\n{json_str}\n')
            return

        if self.path == '/reports/attach/':
            self.do_POST_attach()
        elif self.path == '/reports/new/':
            self.do_POST_new()


PORT = 12345
httpd = HTTPServer(("", PORT), Handler)
httpd.serve_forever()
