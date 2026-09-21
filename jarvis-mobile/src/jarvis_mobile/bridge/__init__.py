"""The link between a Jarvis in the cloud and a phone behind NAT.

The backend runs on a public URL; the phone does not, and nothing on a mobile
network will accept an inbound connection. So the phone dials out: a small
runner in Termux holds a WebSocket open to the backend, and the backend hands
work down it.

What travels is a **subprocess call**, not a tool. The device tools already
express themselves as ``termux-*`` invocations, so the bridge transports argv
and gets back exit status, stdout and stderr — which means the tools keep one
implementation for both deployments, and the runner needs no knowledge of what
a tool is. That also makes the trust boundary plain: whoever holds the device
token can run what the runner allows, so the runner, on the phone, is where
the policy lives.
"""

from jarvis_mobile.bridge.hub import DeviceHub, DeviceOffline, Ran, hub

__all__ = ["DeviceHub", "DeviceOffline", "Ran", "hub"]
