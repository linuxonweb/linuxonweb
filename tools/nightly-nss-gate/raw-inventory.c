/* Preparation source only. Link with the final browser's actual native Wasm
 * trust-anchors objects, record those object hashes, then execute in the guest.
 * This direct getter diagnostic does not establish Firefox's loaded module.
 * Headers must be the complete current NSS family, never an x86 ABI alias. */
#include <stdio.h>
#include <stdlib.h>
#include "pkcs11.h"
#include "pkcs11n.h"

extern CK_RV TRUST_ANCHORS_GetFunctionList(CK_FUNCTION_LIST_PTR_PTR);
static CK_FUNCTION_LIST_PTR f;
static CK_SESSION_HANDLE session;

static void require(CK_RV rv, const char *where) {
  if (rv != CKR_OK) { fprintf(stderr, "%s: CK_RV=%lu\n", where, (unsigned long)rv); exit(1); }
}

static unsigned char *attribute(CK_OBJECT_HANDLE o, CK_ATTRIBUTE_TYPE type,
                                CK_ULONG *length, int optional) {
  CK_ATTRIBUTE a = {type, NULL, 0};
  CK_RV rv = f->C_GetAttributeValue(session, o, &a, 1);
  if (optional && rv == CKR_ATTRIBUTE_TYPE_INVALID && a.ulValueLen == CK_UNAVAILABLE_INFORMATION) {
    *length = CK_UNAVAILABLE_INFORMATION; return NULL;
  }
  require(rv, "attribute length");
  if (a.ulValueLen > 1024 * 1024) { fputs("attribute exceeds bound\n", stderr); exit(1); }
  unsigned char *data = calloc(a.ulValueLen + 1, 1);
  if (!data) exit(1);
  a.pValue = data;
  require(f->C_GetAttributeValue(session, o, &a, 1), "attribute value");
  *length = a.ulValueLen; return data;
}

static CK_ULONG number(CK_OBJECT_HANDLE o, CK_ATTRIBUTE_TYPE type) {
  CK_ULONG length, value;
  unsigned char *data = attribute(o, type, &length, 0);
  if (length != sizeof value) { fputs("native CK_ULONG width mismatch\n", stderr); exit(1); }
  /* No alignment assumption about the attribute buffer. */
  unsigned char *target = (unsigned char *)&value;
  for (size_t i = 0; i < sizeof value; i++) target[i] = data[i];
  free(data); return value;
}

static void hex(CK_OBJECT_HANDLE o, const char *key, CK_ATTRIBUTE_TYPE type, int optional) {
  CK_ULONG length;
  unsigned char *data = attribute(o, type, &length, optional);
  printf(",\"%s\":", key);
  if (!data) { fputs("null", stdout); return; }
  putchar('"');
  for (CK_ULONG i = 0; i < length; i++) printf("%02x", data[i]);
  putchar('"'); free(data);
}

int main(void) {
  if (sizeof(CK_ULONG) != 4 || sizeof(void *) != 4) {
    fputs("native wasm32 ILP32 execution required\n", stderr); return 1;
  }
  require(TRUST_ANCHORS_GetFunctionList(&f), "getter");
  if (!f || !f->C_Initialize || !f->C_GetSlotList || !f->C_OpenSession ||
      !f->C_FindObjectsInit || !f->C_FindObjects || !f->C_GetAttributeValue) return 1;
  /* Do not alias NSS's extended initializer to vendored standard layout. */
  require(f->C_Initialize(NULL), "initialize");
  CK_ULONG count = 0;
  require(f->C_GetSlotList(CK_TRUE, NULL, &count), "slot count");
  if (count != 1) { fputs("expected exactly one static token\n", stderr); return 1; }
  CK_SLOT_ID slot;
  require(f->C_GetSlotList(CK_TRUE, &slot, &count), "slot list");
  CK_TOKEN_INFO info;
  require(f->C_GetTokenInfo(slot, &info), "token info");
  require(f->C_OpenSession(slot, CKF_SERIAL_SESSION, NULL, NULL, &session), "open session");
  require(f->C_FindObjectsInit(session, NULL, 0), "find init");
  printf("{\"schema\":1,\"ckUlongBytes\":%zu,\"pointerBytes\":%zu,\"tokenLabelHex\":\"", sizeof(CK_ULONG), sizeof(void *));
  for (size_t i = 0; i < sizeof info.label; i++) printf("%02x", info.label[i]);
  fputs("\",\"objects\":[", stdout);
  int first = 1;
  size_t total = 0;
  for (;;) {
    CK_OBJECT_HANDLE object;
    require(f->C_FindObjects(session, &object, 1, &count), "find object");
    if (!count) break;
    if (++total > 2048) { fputs("object bound exceeded\n", stderr); return 1; }
    if (!first) putchar(',');
    first = 0;
    CK_ULONG klass = number(object, CKA_CLASS);
    printf("{\"class\":%lu", (unsigned long)klass);
    if (klass == CKO_CERTIFICATE) {
      hex(object, "valueHex", CKA_VALUE, 0);
      hex(object, "mozillaPolicyHex", CKA_NSS_MOZILLA_CA_POLICY, 1);
      hex(object, "serverDistrustHex", CKA_NSS_SERVER_DISTRUST_AFTER, 1);
      hex(object, "emailDistrustHex", CKA_NSS_EMAIL_DISTRUST_AFTER, 1);
    } else if (klass == CKO_TRUST) {
      hex(object, "hashHex", CKA_HASH_OF_CERTIFICATE, 0);
      printf(",\"trustServer\":%lu,\"trustEmail\":%lu,\"trustClient\":%lu,\"trustCode\":%lu",
             (unsigned long)number(object, CKA_PKCS_TRUST_SERVER_AUTH),
             (unsigned long)number(object, CKA_PKCS_TRUST_EMAIL_PROTECTION),
             (unsigned long)number(object, CKA_PKCS_TRUST_CLIENT_AUTH),
             (unsigned long)number(object, CKA_PKCS_TRUST_CODE_SIGNING));
    } else if (klass != CKO_NSS_BUILTIN_ROOT_LIST) { fputs("unknown class\n", stderr); return 1; }
    putchar('}');
  }
  require(f->C_FindObjectsFinal(session), "find final");
  require(f->C_CloseSession(session), "close session");
  require(f->C_Finalize(NULL), "finalize");
  fputs("]}\n", stdout);
  return fflush(stdout) ? 1 : 0;
}
