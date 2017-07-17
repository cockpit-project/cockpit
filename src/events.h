#pragma once

#include "manager.h"

#include <libvirt/libvirt.h>


void
virt_manager_register_events(VirtManager *manager);
