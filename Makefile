
libvirt-dbus: src/main.c src/manager.c | src/util.h src/manager.h
	gcc -ggdb3 -Wall `pkg-config --cflags --libs libsystemd libvirt` -o $@ $^
