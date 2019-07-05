# This file is part of Cockpit.
#
# Copyright (C) 2019 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

# Shared GitHub code. When run as a script, we print out info about
# our GitHub interacition.

import ssl
import logging

no_amqp = False
try:
    import pika
except ImportError:
    no_amqp = True

logging.getLogger("pika").propagate = False

__all__ = (
    'DistributedQueue',
    'BASELINE_PRIORITY',
    'MAX_PRIORITY',
    'no_amqp',
)

BASELINE_PRIORITY = 5
MAX_PRIORITY = 9

arguments = {
    'rhel': {
        "x-max-priority": MAX_PRIORITY
    },
    'public': {
        "x-max-priority": MAX_PRIORITY
    },
}

class DistributedQueue(object):
    def __init__(self, amqp_server, queues, **kwargs):
        """connect to some AMQP queues

        amqp_server should be formatted as host:port

        queues should be a list of strings with the names of queues, each queue
        will be declared and usable

        any extra arguments in **kwargs will be passed to queue_declare()

        the results of the result declarations are stored in
        DistributedQueue.declare_results, a dict mapping queue name to result

        when passive=True is passed to queue_declare() and the queue does not
        exist, the declare result will be None
        """
        if no_amqp:
            raise ImportError('pika is not available')

        try:
            host, port = amqp_server.split(':')
        except ValueError:
            raise ValueError('Please format amqp_server as host:port')
        context = ssl.create_default_context(cafile='/run/secrets/webhook/ca.pem')
        context.load_cert_chain(keyfile='/run/secrets/webhook/amqp-client.key',
            certfile='/run/secrets/webhook/amqp-client.pem')
        context.check_hostname = False
        self.connection = pika.BlockingConnection(pika.ConnectionParameters(
            host=host,
            port=int(port),
            ssl_options=pika.SSLOptions(context, server_hostname=host),
            credentials=pika.credentials.ExternalCredentials()))
        self.channel = self.connection.channel()
        self.declare_results = {}

        for queue in queues:
            try:
                result = self.channel.queue_declare(queue=queue, arguments=arguments.get(queue, None), **kwargs)
                self.declare_results[queue] = result
            except pika.exceptions.ChannelClosedByBroker as e:
                # unknown error
                if e.reply_code != 404:
                    raise e
                # queue does not exist
                self.declare_results[queue] = None
                self.channel = self.connection.channel()

    def __enter__(self):
        return self

    def __exit__(self, type, value, traceback):
        self.connection.close()
