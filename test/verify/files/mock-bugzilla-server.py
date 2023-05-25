#!/usr/bin/python3

from xmlrpc.server import SimpleXMLRPCRequestHandler, SimpleXMLRPCServer


class RequestHandler(SimpleXMLRPCRequestHandler):
    rpc_paths = ('/xmlrpc.cgi',)


with SimpleXMLRPCServer(('', 8080), requestHandler=RequestHandler) as server:
    class Bugzilla:
        @server.register_function(name='Bugzilla.version')
        def version(self):
            return {'version': '42'}

    server.register_instance(Bugzilla())

    server.serve_forever()
