Description for Alarm Module
-------------------------------

This adds functionality to Cockpit to configure and send alarms.

When hardware resources such as CPU, RAM and DISK are continously
under pressure, this module will help to manage the resources on 
host machine.

## Added Feature

Alarms module allows to monitor the hardware resources CPU and memory
usage. The module is providing the confgurations via cockpit UI and 
store and udpate the configured values to send the email/trap/alarm
to the configured destinations.

The moudle configration is shown named as "Alarms" in the main menu.

We can enable of disable the alarms by the switch provided on the 
Alarms page. 

The Alarms page does display the stored configured values. All the 
Alarm configurations are stored in "/etc/cockpit/cockpit-alarms.conf"
file.

UI is providing the easy managing the configurations via UI.

## To Do (Core functionality)

functionality to generate the alarms and send to the destinations.
The metrics page does contain the pooling of CPU and memory so need
to integrate with metrics module.

## Future Enhancements

The future enahcements possible are:
- Adding more hardware resources like disks, networks, sensors.
- Adding page to display the alarms and their status.

### Configurations

This module does contain configurations for hardware resources to monitor and
the fail conditions. Initially the configurations are:
- CPU Threshold
- Memory Threshold
- Frequency
- Count

[CPU]
CPU threshold is the integer (0-100)%, will capture the CPU load at an interval
which is defined by *FREQ* configuration. If the CPU load keeps crossing the 
threshold value for the configured number of times (configured as *COUNT*) continously.

**TODO**
The metrics page will be displaying a alarm/log for the failed time and details. The
module will also be sending an email to the configured email users OR SNMP initiate
SNMP traps to the trapsink ip.

[Memory]
Similar to CPU configurations, we set the memory threshold to cross in GB. If the
memory used is more than threshold for FREQ\*COUNT seconds continously.

Default value is (4) GB.

**TODO**
The alarm/email/traps to be generated from metrics module.

[FREQ]
Frequency is the time interval in seconds for pooling the resources. 
Default is (60) seconds.

[COUNT]
This is the number of times the system will be checking for continous breech of 
threshold before raisng a alarm.

All the configurations will be read from **"/etc/cockpit/cockpit-alarms.conf"**
