# Recover stalled native enhancement synchronization

A long-lived CDP socket can remain open but stop responding. Repeated Runtime.addBinding timeouts currently reuse the same connection and target id, so labels and annotation polling stop updating.

On a CDP transport timeout or closed-connection error, detach the binding listener, clear the cached connection/target and close that connection. The next existing polling cycle rediscovers and reattaches the owner without restarting it. Other errors keep the connection. Cover transport failure and non-transport failure with regression tests.
