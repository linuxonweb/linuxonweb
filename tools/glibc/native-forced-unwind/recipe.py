#!/usr/bin/env python3
"""Print a bounded sparse recipe; this proposal deliberately executes no build."""
import sys
sys.dont_write_bytecode=True
from common import T,R,S,L,C,pin
import json
B=T/'source/llvm'
old=T.parent/'glibc-native-eh-routing-20261002'
plan={
 'status':'UNCOMPILED_SOURCE_PROPOSAL', 'execute':False,
 'capBytes':2147483648,'launchReserveBytes':8589934592,'stopReserveBytes':5368709120,
 'timeoutSecondsPerStage':300,'parallelCompiles':1,'afterAdapterLTO':False,
 'frontend':{'path':str(C),**pin(C)},
 'compilerSources':[str(B/'lib/CodeGen/WasmEHPrepare.cpp'),str(B/'lib/Target/WebAssembly/WebAssemblyCFGStackify.cpp')],
 'archiveChanges':{'libLLVMCodeGen.a':['WasmEHPrepare.cpp.o'],
   'libLLVMWebAssemblyCodeGen.a':['WebAssemblyCFGStackify.cpp.o','reviewed module4 WebAssemblyFrameLowering.cpp.o','reviewed module4 WebAssemblyTargetMachine.cpp.o']},
 'extraLinkObject':'reviewed module4 WebAssemblyGNUFrames.cpp.o (not inserted into 45-member target archive)',
 'driverObjects':[str(old/'objects/llc.cpp.o'),str(old/'objects/NewPMDriver.cpp.o')],
 'sourceDependencies':[str(R/'Unwind-wasm-gnu.c'),str(R/'forced-abi.h'),str(R/'frame-abi.h'),str(R/'gnu-unwind.h'),str(R/'jmpbuf-unwind.h')],
 'stages':[
   ['llvm-config','--cxxflags'],
   ['g++','PINNED_CXXFLAGS','-DNDEBUG','-O1','-g0','-I'+str(old/'objects/generated'),'-I'+str(S/'llvm/lib/Target/WebAssembly'),'-MD','-MF','OWNED_VERSIONED_DEPFILE','-c','OWNED_SOURCE','-o','OWNED_VERSIONED_OBJECT'],
   ['llvm-ar','r','OWNED_COPY_CODEGEN_ARCHIVE','OWNED_WasmEHPrepare.cpp.o'],
   ['llvm-ar','r','OWNED_COPY_TARGET_ARCHIVE','OWNED_CFGStackify.o','PINNED_MODULE4_FrameLowering.o','PINNED_MODULE4_TargetMachine.o'],
   ['ordered-archive-audit','all members in both archives, duplicate names and order, exact declared replacements only'],
   ['llvm-config','--libfiles','all'],['llvm-config','--system-libs'],
   ['g++','-fuse-ld=lld','-o','NEW_PRIVATE_LLC','PINNED_DRIVER_OBJECTS','PINNED_GNUFrames.o','-Wl,--start-group','ALL_PINNED_LLVM_LIBS_WITH_TWO_OWNED_ARCHIVES','-Wl,--end-group','PINNED_SYSTEM_LIBS','-pthread'],
   ['PRIVATE_LLC','--version'],
   ['ACCEPTED_FRONTEND','--target=wasm32-unknown-linux-gnu','-nostdinc','COHERENT_GNU_INCLUDE_FLAGS','-O0/-O2/-O3','-fexceptions','-fwasm-exceptions','-matomics','-mbulk-memory','-fno-optimize-sibling-calls','-emit-llvm','-c','REAL_GNU_C_OR_CXX_SOURCE','-o','RETAINED_FRONTEND_BC'],
   ['FINITE_PRE_O2_ADAPTER','actual caller-SP/safepoint markers plus coverage and root admission','NO_POST_ADAPTER_LTO'],
   ['PRIVATE_LLC','-O0/-O2/-O3','-exception-model=wasm','-wasm-enable-sjlj','-wasm-use-legacy-eh=true','-wasm-native-eh-routing','-wasm-gnu-frame-records','-wasm-gnu-forced-unwind','-verify-machineinstrs','-filetype=obj','ACTUAL_RETAINED_BC','-o','NEW_VERSIONED_OBJECT'],
   ['STRICT_WASM_LD','exact pinned genuine GNU/default libc++abi objects','NO_UNDEFINED_SUPPRESSION_OR_CANCEL_STUBS'],
   ['NATIVE_EXECUTION','finite cases','NO_JS_SP_RESET','terminal PID/PGID empty proof']
 ],
 'blockingInputs':[
   'root-reviewed module4 records compiler/runtime with EH+activeSP restoration admission; records-only is rejected',
   'actual per-environment registration and native matching-edge marker; no single-slot/static-site shortcut',
   'root-reviewed terminal context/fatal generic-stop boundary; END is not a normal root CFA',
   'machine-audited primitive bodies, canonical GNU TP/TLS/task epoch/module generations',
   'full admitted fixture and genuine helper/default C++ closure with no invented available cancellation provider'
 ],
 'acceptance':False}
print(json.dumps(plan,indent=2))
