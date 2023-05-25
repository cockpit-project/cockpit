#!/usr/bin/python3
# export uReport_URL="http://localhost:12345"

import cgi
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST_attach(self):
        self.wfile.write(json.dumps({'result': True}).encode("UTF-8"))

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
        self.wfile.write(json.dumps(response, indent=2).encode('UTF-8'))

    def do_POST(self):
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                'REQUEST_METHOD': 'POST',
                'CONTENT_TYPE': self.headers['Content-Type'],
            }
        )

        self.send_response(202)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Connection', 'close')
        self.end_headers()

        json_str = form['file'].file.read()
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
