/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Linux/wasm XPTCall uses the browser's mandatory 23-i64 fpcast ABI.
// Raw modules must not execute this adapter before --fpcast-emu. Values are
// bit-preserving: i32/pointers/f32 zero-extend; i64/f64 retain all 64 bits.
// Unlike a signature whitelist, current XPIDL metadata drives every call.
#include "xptcprivate.h"
#include <stdint.h>
#include <string.h>

namespace {
constexpr uint32_t kWasmArgs = 22;  // 23 slots including the interface pointer.

bool DecodeParam(const nsXPTParamInfo& param, uint64_t bits,
                 nsXPTCMiniVariant& value) {
  const nsXPTType& type = param.Type();
  if (param.IsOut() || !type.IsArithmetic()) {
    value.val.p = reinterpret_cast<void*>(uintptr_t(bits));
    return true;
  }
  switch (type) {
    case nsXPTType::T_I8: value.val.i8 = int8_t(bits); break;
    case nsXPTType::T_I16: value.val.i16 = int16_t(bits); break;
    case nsXPTType::T_I32: value.val.i32 = int32_t(bits); break;
    case nsXPTType::T_I64: memcpy(&value.val.i64, &bits, sizeof(bits)); break;
    case nsXPTType::T_U8: value.val.u8 = uint8_t(bits); break;
    case nsXPTType::T_U16: value.val.u16 = uint16_t(bits); break;
    case nsXPTType::T_U32: value.val.u32 = uint32_t(bits); break;
    case nsXPTType::T_U64: value.val.u64 = bits; break;
    case nsXPTType::T_FLOAT: {
      uint32_t word = uint32_t(bits);
      memcpy(&value.val.f, &word, sizeof(word)); break;
    }
    case nsXPTType::T_DOUBLE: memcpy(&value.val.d, &bits, sizeof(bits)); break;
    case nsXPTType::T_BOOL: value.val.b = bool(bits); break;
    case nsXPTType::T_CHAR: value.val.c = char(bits); break;
    case nsXPTType::T_WCHAR: value.val.wc = char16_t(bits); break;
    default: return false;
  }
  return true;
}

uint64_t EncodeParam(const nsXPTCVariant& param) {
  if (param.IsIndirect()) return uintptr_t(&param.val);
  switch (param.type) {
    case nsXPTType::T_I8: return uint32_t(int32_t(param.val.i8));
    case nsXPTType::T_I16: return uint32_t(int32_t(param.val.i16));
    case nsXPTType::T_I32: return uint32_t(param.val.i32);
    case nsXPTType::T_I64: return uint64_t(param.val.i64);
    case nsXPTType::T_U8: return param.val.u8;
    case nsXPTType::T_U16: return param.val.u16;
    case nsXPTType::T_U32: return param.val.u32;
    case nsXPTType::T_U64: return param.val.u64;
    case nsXPTType::T_FLOAT: {
      uint32_t bits; memcpy(&bits, &param.val.f, sizeof(bits)); return bits;
    }
    case nsXPTType::T_DOUBLE: {
      uint64_t bits; memcpy(&bits, &param.val.d, sizeof(bits)); return bits;
    }
    case nsXPTType::T_BOOL: return param.val.b;
    case nsXPTType::T_CHAR: return uint32_t(int32_t(param.val.c));
    case nsXPTType::T_WCHAR: return param.val.wc;
    default: return uintptr_t(param.val.p);
  }
}

nsresult Dispatch(nsXPTCStubBase* self, uint16_t method,
                  const uint64_t* args) {
  const nsXPTMethodInfo* info = nullptr;
  if (NS_FAILED(self->mEntry->GetMethodInfo(method, &info)) || !info)
    return NS_ERROR_FAILURE;
  const uint32_t count = info->ParamCount();
  const uint32_t total = count + info->WantsContext() + info->WantsOptArgc();
  if (total > kWasmArgs) return NS_ERROR_NOT_IMPLEMENTED;
  const uint32_t contextIndex = info->IndexOfJSContext();
  const uint32_t optIndex = info->WantsOptArgc()
      ? count - uint32_t(info->HasRetval()) + info->WantsContext() : UINT32_MAX;
  nsXPTCMiniVariant params[kWasmArgs]{};
  uint32_t param = 0;
  for (uint32_t slot = 0; slot < total; ++slot) {
    // Match current CallMethodHelper ordering. Hidden arguments are omitted
    // from nsIXPTCProxy::CallMethod's metadata-indexed parameter array.
    if (slot == contextIndex || slot == optIndex) continue;
    if (!DecodeParam(info->Param(param), args[slot], params[param]))
      return NS_ERROR_NOT_IMPLEMENTED;
    ++param;
  }
  if (param != count) return NS_ERROR_FAILURE;
  return self->mOuter->CallMethod(method, info, params);
}

template <uint16_t Method>
uint64_t WasmStub(uint64_t selfBits, uint64_t a0, uint64_t a1, uint64_t a2, uint64_t a3, uint64_t a4, uint64_t a5, uint64_t a6, uint64_t a7, uint64_t a8, uint64_t a9, uint64_t a10, uint64_t a11, uint64_t a12, uint64_t a13, uint64_t a14, uint64_t a15, uint64_t a16, uint64_t a17, uint64_t a18, uint64_t a19, uint64_t a20, uint64_t a21) {
  auto* self = reinterpret_cast<nsXPTCStubBase*>(uintptr_t(selfBits));
  const uint64_t args[kWasmArgs] = {a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21};
  return uint32_t(Dispatch(self, Method, args));
}

#define STUB_ENTRY(n) reinterpret_cast<uintptr_t>(&WasmStub<n>),
#define SENTINEL_ENTRY(n) 0,
const uintptr_t kWasmStubs[] = {0, 0, 0,
#include "xptcstubsdef.inc"
};
#undef STUB_ENTRY
#undef SENTINEL_ENTRY
}  // namespace

nsresult WasmInitXPTCStub(nsXPTCStubBase* stub) {
  // Stub3 through Stub249, followed by the real sentinel slots. Preserve
  // the two Itanium/WebAssembly vtable header words used by dynamic casts.
  constexpr size_t entries = sizeof(kWasmStubs) / sizeof(kWasmStubs[0]);
  if (stub->mEntry->MethodCount() > 250) return NS_ERROR_NOT_IMPLEMENTED;
  for (uint16_t i = 3; i < stub->mEntry->MethodCount(); ++i) {
    const auto& info = stub->mEntry->Method(i);
    if (uint32_t(info.ParamCount()) + info.WantsContext() + info.WantsOptArgc()
        > kWasmArgs) return NS_ERROR_NOT_IMPLEMENTED;
  }
  auto** vptr = reinterpret_cast<uintptr_t**>(stub);
  const uintptr_t* original = *vptr;
  stub->mWasmVTable = new uintptr_t[entries + 2];
  memcpy(stub->mWasmVTable, original - 2, (entries + 2) * sizeof(uintptr_t));
  for (uint16_t i = 3; i < stub->mEntry->MethodCount(); ++i)
    stub->mWasmVTable[i + 2] = kWasmStubs[i];
  *vptr = stub->mWasmVTable + 2;
  return NS_OK;
}

// These entries are replaced before a proxy can escape NS_GetXPTCallStub.
// Keep invalid/unused virtual slots as explicit failures.
#define STUB_ENTRY(n) nsresult nsXPTCStubBase::Stub##n() { return NS_ERROR_NOT_IMPLEMENTED; }
#define SENTINEL_ENTRY(n) nsresult nsXPTCStubBase::Sentinel##n() { return NS_ERROR_NOT_IMPLEMENTED; }
#include "xptcstubsdef.inc"
#undef STUB_ENTRY
#undef SENTINEL_ENTRY

EXPORT_XPCOM_API(nsresult)
NS_InvokeByIndex(nsISupports* that, uint32_t methodIndex, uint32_t paramCount,
                 nsXPTCVariant* params) {
  if (!that || (paramCount && !params)) return NS_ERROR_INVALID_ARG;
  if (paramCount > kWasmArgs) return NS_ERROR_NOT_IMPLEMENTED;
  uint64_t args[23]{};
  args[0] = uintptr_t(that);
  for (uint32_t i = 0; i < paramCount; ++i) args[i + 1] = EncodeParam(params[i]);
  uintptr_t method = (*reinterpret_cast<uintptr_t**>(that))[methodIndex];
  using Invoke = uint64_t (*)(uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t, uint64_t);
  return nsresult(uint32_t(reinterpret_cast<Invoke>(method)(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8], args[9], args[10], args[11], args[12], args[13], args[14], args[15], args[16], args[17], args[18], args[19], args[20], args[21], args[22])));
}
