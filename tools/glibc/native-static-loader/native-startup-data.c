/* GNU elf/dl-support.c's unchanged static-loader diagnostic initializer.
   __progname remains the genuine GNU variable; this does not invent argv. */
extern char *__progname;
char **_dl_argv = &__progname;
