
libvirt-dbus: src/main.c src/manager.c src/domain.c src/util.c | src/util.h src/manager.h
	gcc -D_GNU_SOURCE -ggdb3 -Wall `pkg-config --cflags --libs libsystemd libvirt` -o $@ $^
