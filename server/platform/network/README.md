# Network

This directory contains host-level network configuration helpers shared by
server entry points. It resolves the operating system proxy into environment
variables that supported Node.js network clients can use.

Keep this layer independent of feature modules and third-party plugins. Feature
and plugin-specific request behavior belongs with its owning module.
