/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * CockpitFlow:
 *
 * An interface representing a bidirectional flow. Implementors are
 * CockpitPipe and CockpitStream. Currently the interface functionality
 * is limited to flow control.
 *
 *  - Its input can be throttled, it can listen to a "pressure" signal
 *    from another object passed into cockpit_pipe_throttle()
 *  - It can optionally control another flow, by emitting a "pressure" signal
 *    when it's output queue is too large
 */

#include "config.h"

#include "cockpitflow.h"

G_DEFINE_INTERFACE (CockpitFlow, cockpit_flow, 0);

static guint cockpit_flow_signal_pressure = 0;

static void
cockpit_flow_default_init (CockpitFlowInterface *iface)
{
  /**
   * CockpitFlow::pressure:
   * @throttle: Pressure on or off
   *
   * Emitted when the pipe wants to give back-pressure to other feeding
   * streams. It does this when its output queue is too long and should
   * slow down.
   */
  cockpit_flow_signal_pressure = g_signal_new ("pressure", COCKPIT_TYPE_FLOW, G_SIGNAL_RUN_FIRST,
                                               0, NULL, NULL, g_cclosure_marshal_VOID__BOOLEAN,
                                               G_TYPE_NONE, 1, G_TYPE_BOOLEAN);
}

/**
 * cockpit_flow_throttle:
 * @flow: The flow to have input throttled
 * @controlling: A controlling flow that throttles this one
 *
 * When the @controlling flow has pressure, it will slow input on this
 * flow. If @controlling is NULL
 */
void
cockpit_flow_throttle (CockpitFlow *flow,
                       CockpitFlow *controlling)
{
  CockpitFlowInterface *iface;

  g_return_if_fail (COCKPIT_IS_FLOW (flow));
  g_return_if_fail (controlling == NULL || COCKPIT_IS_FLOW (controlling));

  iface = COCKPIT_FLOW_GET_IFACE (flow);
  g_return_if_fail (iface->throttle != NULL);
  (iface->throttle) (flow, controlling);
}

/**
 * cockpit_flow_emit_pressure:
 * @flow: The flow
 * @ressure: Whether to emit back-pressure or release it.
 *
 * Emit a "pressure" signal, which indicates back-pressure or
 * releases it. Used by implementations of CockpitFlow
 *
 * This is used to throttle another flow's input if this
 * flow is the controlling flow.
 */
void
cockpit_flow_emit_pressure   (CockpitFlow *flow,
                              gboolean pressure)
{
  g_return_if_fail (COCKPIT_IS_FLOW (flow));
  g_signal_emit (flow, cockpit_flow_signal_pressure, 0, pressure);
}
