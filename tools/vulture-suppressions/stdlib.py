import asyncio
import ssl
import unittest
import tempfile
import xmlrpc.server

asyncio.BaseTransport.get_protocol
asyncio.BaseTransport.set_protocol
asyncio.ReadTransport.is_reading
asyncio.SubprocessTransport.get_pipe_transport
asyncio.WriteTransport.get_write_buffer_limits
asyncio.WriteTransport.get_write_buffer_size
asyncio.WriteTransport.set_write_buffer_limits

ssl.create_default_context().check_hostname
ssl.create_default_context().verify_mode

unittest.IsolatedAsyncioTestCase.asyncTearDown

tempfile.TemporaryDirectory._rmtree  # type: ignore

xmlrpc.server.SimpleXMLRPCRequestHandler.rpc_paths
