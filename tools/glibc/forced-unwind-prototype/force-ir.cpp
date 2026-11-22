#include <llvm/IR/IRBuilder.h>
#include <llvm/IR/Verifier.h>
#include <llvm/IR/IntrinsicInst.h>
#include <llvm/IR/IntrinsicsWebAssembly.h>
#include <llvm/IRReader/IRReader.h>
#include <llvm/Bitcode/BitcodeWriter.h>
#include <llvm/Support/SourceMgr.h>
#include <llvm/Support/FileSystem.h>
#include <llvm/Support/raw_ostream.h>
using namespace llvm;
int main(int argc,char **argv){
 if(argc!=3)return 2;LLVMContext C;SMDiagnostic E;auto M=parseIRFile(argv[1],E,C);if(!M){E.print(argv[0],errs());return 2;}
 auto *P=PointerType::getUnqual(C);auto *I=Type::getInt32Ty(C);auto *V=Type::getVoidTy(C);
 auto Enter=M->getOrInsertFunction("prototype_enter",FunctionType::get(V,{P,P,I},false));
 auto Leave=M->getOrInsertFunction("prototype_leave",FunctionType::get(V,{P},false));
 auto Publish=M->getOrInsertFunction("prototype_publish",FunctionType::get(V,{P},false));
 auto Stop=M->getOrInsertFunction("prototype_stop",FunctionType::get(V,{P,P},false));
 for(auto FC:{Enter,Leave,Publish})cast<Function>(FC.getCallee())->addFnAttr(Attribute::NoUnwind);
 auto *SS=Intrinsic::getOrInsertDeclaration(M.get(),Intrinsic::stacksave,{P});
 auto *GetEx=Intrinsic::getOrInsertDeclaration(M.get(),Intrinsic::wasm_get_exception);
 auto Forward=M->getOrInsertFunction("prototype_forward_tag0",FunctionType::get(V,{P},false));
 unsigned funcs=0,guards=0;
 for(auto &F:*M){if(F.isDeclaration())continue;
  if(!F.getName().starts_with("fixture_")){errs()<<"uncovered definition "<<F.getName()<<"\n";return 3;}
  F.removeFnAttr(Attribute::NoUnwind);F.addFnAttr("disable-tail-calls","true");
  unsigned id=F.getName()=="fixture_run"?1:F.getName()=="fixture_middle"?2:F.getName()=="fixture_inner"?3:F.getName()=="fixture_cpp_middle"?4:5;
  IRBuilder<> B(&*F.getEntryBlock().getFirstInsertionPt());auto *Record=B.CreateAlloca(ArrayType::get(I,8),nullptr,"fu.frame");Record->setAlignment(Align(16));B.CreateCall(Enter,{Record,B.CreateCall(SS),B.getInt32(id)});++funcs;
  SmallVector<InvokeInst*,16> invokes;SmallVector<Instruction*,16> leaves;
  SmallVector<CallBase*,32> calls;
  for(auto &BB:F)for(auto &N:BB){if(auto *CB=dyn_cast<CallBase>(&N)){if(!isa<IntrinsicInst>(CB))calls.push_back(CB);}if(auto *II=dyn_cast<InvokeInst>(&N))invokes.push_back(II);if(isa<ReturnInst>(N))leaves.push_back(&N);if(auto *CR=dyn_cast<CleanupReturnInst>(&N))if(CR->unwindsToCaller())leaves.push_back(CR);}
  for(auto *CB:calls){auto *Fn=CB->getCalledFunction();if(!Fn){errs()<<"indirect coverage unsupported\n";return 3;}auto Name=Fn->getName();
   if(Name.starts_with("fixture_")||Name=="prototype_raise"){IRBuilder<> PB(CB);PB.CreateCall(Publish,{PB.CreateCall(SS)});}
   else if(!(Name.starts_with("prototype_")||Name=="setjmp"||Name=="abort")){errs()<<"uncovered call "<<Name<<"\n";return 3;}
  }
  for(auto *N:leaves){IRBuilder<> LB(N);if(auto *CR=dyn_cast<CleanupReturnInst>(N))LB.CreateCall(Leave,{Record},OperandBundleDef("funclet",CR->getCleanupPad()));else LB.CreateCall(Leave,{Record});}
  for(auto *II:invokes){auto *Old=II->getUnwindDest();auto *Pad=dyn_cast<CleanupPadInst>(Old->getFirstNonPHIIt());if(!Pad||!isa<ConstantTokenNone>(Pad->getParentPad()))continue;
   auto *Fn=II->getCalledFunction();if(Fn&&Fn->getName()=="setjmp")continue;
   auto *Dispatch=BasicBlock::Create(C,"fu.dispatch",&F);auto *Guard=BasicBlock::Create(C,"fu.guard",&F);auto *Dead=BasicBlock::Create(C,"fu.dead",&F);
   IRBuilder<> DB(Dispatch);auto *CS=DB.CreateCatchSwitch(ConstantTokenNone::get(C),nullptr,1);CS->addHandler(Guard);
   IRBuilder<> GB(Guard);auto *CP=GB.CreateCatchPad(CS,{ConstantPointerNull::get(P)});auto *Ex=GB.CreateCall(GetEx,{CP});
   // The may-throw stop call's parent catchswitch unwinds to caller/SjLj;
   // only the original tag0 rethrow has the original cleanup as destination.
   GB.CreateCall(Stop,{Ex,Record},OperandBundleDef("funclet",CP));
   auto *ForwardBB=BasicBlock::Create(C,"fu.forward",&F);
   GB.CreateCatchRet(CP,ForwardBB);
   IRBuilder<> FB(ForwardBB);FB.CreateInvoke(Forward,Dead,Old,{Ex});
   IRBuilder<> UB(Dead);UB.CreateUnreachable();
   for(auto &PN:Old->phis()){int ix=PN.getBasicBlockIndex(II->getParent());if(ix>=0)PN.setIncomingBlock(ix,ForwardBB);}
   II->setUnwindDest(Dispatch);++guards;
  }
 }
 errs()<<"covered-functions="<<funcs<<" guards="<<guards<<"\n";
 if(verifyModule(*M,&errs()))return 4;std::error_code EC;raw_fd_ostream O(argv[2],EC,sys::fs::OF_None);if(EC)return 2;WriteBitcodeToFile(*M,O);return 0;
}
