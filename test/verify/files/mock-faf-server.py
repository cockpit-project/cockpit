#!/usr/bin/python2
# export uReport_URL="http://localhost:12345"

import cgi
import json
import BaseHTTPServer
import sys

class Handler(BaseHTTPServer.BaseHTTPRequestHandler):
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
            sys.stderr.write('Received invalid JSON data:\n{0}\n'.format(json_str))
            return

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
            'result': Handler.known.next()
        }
        json.dump(response, self.wfile, indent=2)

PORT = 12345
Handler.known = [True, False].__iter__()
httpd = BaseHTTPServer.HTTPServer(("", PORT), Handler)
httpd.serve_forever()
