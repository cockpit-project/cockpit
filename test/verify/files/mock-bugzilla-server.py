#!/usr/bin/python3

from xmlrpc.server import SimpleXMLRPCServer, SimpleXMLRPCRequestHandler


class RequestHandler(SimpleXMLRPCRequestHandler):
    rpc_paths = ('/xmlrpc.cgi',)


with SimpleXMLRPCServer(('', 8080), requestHandler=RequestHandler) as server:
    class Bug:
        @server.register_function(name='Bug.add_attachment')
        def add_attachment(self):
            return {'ids': [42]}

        @server.register_function(name='Bug.create')
        def create(self):
            return {'id': 42}

        @server.register_function(name='Bug.search')
        def search(self):
            return {'bugs': []}

        @server.register_function(name='Bug.update')
        def update(self):
            return {'bugs': []}

    class Bugzilla:
        @server.register_function(name='Bugzilla.version')
        def version(self):
            return {'version': '42'}

    class User:
        @server.register_function(name='User.login')
        def login(self):
            return {'id': 0, 'token': '70k3n'}

        @server.register_function(name='User.logout')
        def logout(self):
            return {}

    server.register_instance(Bugzilla())

    server.serve_forever()
