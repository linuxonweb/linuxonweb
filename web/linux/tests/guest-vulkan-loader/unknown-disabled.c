/* Deliberate static-port boundary. Typed core/known extension dispatch remains
 * upstream; unknown names are rejected, never routed through ABI-unsafe thunks. */
#include "unknown_function_handling.h"
void loader_init_dispatch_dev_ext(struct loader_instance *inst, struct loader_device *dev) { (void)inst; (void)dev; }
void *loader_dev_ext_gpa_tramp(struct loader_instance *inst, const char *name) { (void)inst; (void)name; return NULL; }
void *loader_dev_ext_gpa_term(struct loader_instance *inst, const char *name) { (void)inst; (void)name; return NULL; }
void *loader_phys_dev_ext_gpa_tramp(struct loader_instance *inst, const char *name) { (void)inst; (void)name; return NULL; }
void *loader_phys_dev_ext_gpa_term(struct loader_instance *inst, const char *name) { (void)inst; (void)name; return NULL; }
void loader_free_dev_ext_table(struct loader_instance *inst) { (void)inst; }
void loader_free_phys_dev_ext_table(struct loader_instance *inst) { (void)inst; }
