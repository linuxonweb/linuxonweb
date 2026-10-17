/* xclip uses only these two atom conveniences from libXmu. Static Xlib
 * supplies XInternAtom directly; no GLX, Xmu library, or behavioral shim. */
#ifndef LOW_XMU_ATOMS_H
#define LOW_XMU_ATOMS_H
#include <X11/Xlib.h>
#include <X11/Xresource.h>
#define XA_CLIPBOARD(dpy) XInternAtom((dpy), "CLIPBOARD", False)
#define XA_UTF8_STRING(dpy) XInternAtom((dpy), "UTF8_STRING", False)
#endif
