// Works around a bug in shairport-sync 5.5: in classic AirPlay mode it overwrites the port from the config
// file and the command line with 5000, so a second receiver on the same machine fails to start.
// With LD_PRELOAD=portshim.so and SPS_PORT=<port>, port 5000 is replaced by SPS_PORT when the socket is
// bound (bind) and when the service is announced via Bonjour (Avahi). Without SPS_PORT nothing changes.
// Built by deploy/install.sh: gcc -shared -fPIC -O2 -o portshim.so portshim.c -ldl
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdlib.h>
#include <netinet/in.h>
#include <sys/socket.h>

#define SPS_DEFAULT_PORT 5000

static int wanted(void) {
  const char *s = getenv("SPS_PORT");
  int p = s ? atoi(s) : 0;
  return p > 0 && p < 65536 ? p : 0;
}

int bind(int fd, const struct sockaddr *addr, socklen_t len) {
  static int (*real)(int, const struct sockaddr *, socklen_t);
  if (!real) real = (int (*)(int, const struct sockaddr *, socklen_t))dlsym(RTLD_NEXT, "bind");
  int port = wanted();
  if (port && addr && addr->sa_family == AF_INET && len >= sizeof(struct sockaddr_in)
      && ntohs(((const struct sockaddr_in *)addr)->sin_port) == SPS_DEFAULT_PORT) {
    struct sockaddr_in copy = *(const struct sockaddr_in *)addr;
    copy.sin_port = htons(port);
    return real(fd, (const struct sockaddr *)&copy, sizeof copy);
  }
  if (port && addr && addr->sa_family == AF_INET6 && len >= sizeof(struct sockaddr_in6)
      && ntohs(((const struct sockaddr_in6 *)addr)->sin6_port) == SPS_DEFAULT_PORT) {
    struct sockaddr_in6 copy = *(const struct sockaddr_in6 *)addr;
    copy.sin6_port = htons(port);
    return real(fd, (const struct sockaddr *)&copy, sizeof copy);
  }
  return real(fd, addr, len);
}

// Signature as in avahi-client/publish.h, with plain types instead of the Avahi headers
typedef int (*add_service_fn)(void *group, int interface, int protocol, unsigned flags, const char *name,
                              const char *type, const char *domain, const char *host, uint16_t port, void *txt);

int avahi_entry_group_add_service_strlst(void *group, int interface, int protocol, unsigned flags,
                                         const char *name, const char *type, const char *domain,
                                         const char *host, uint16_t port, void *txt) {
  static add_service_fn real;
  if (!real) real = (add_service_fn)dlsym(RTLD_NEXT, "avahi_entry_group_add_service_strlst");
  int wanted_port = wanted();
  if (wanted_port && port == SPS_DEFAULT_PORT) port = (uint16_t)wanted_port;
  return real(group, interface, protocol, flags, name, type, domain, host, port, txt);
}
