// Included verbatim into owned WasmEHPrepare by prepare-v2.py. Prepared only.
bool WasmEHPrepareImpl::prepareGNUTargets(Function &F) {
  auto &M=*F.getParent(); auto &DL=M.getDataLayout();
  auto Fail=[]() { report_fatal_error("invalid compiler GNU native matching target dataflow"); };
  for(auto [Name,Expected] : {std::pair<StringRef,unsigned>{"wasm.gnu.jump.backend.bytes",64},
                            {"wasm.gnu.jump.delivery.abi",2}}) {
    unsigned Count=0;
    if(auto *Flags=M.getModuleFlagsMetadata()) for(auto *Flag:Flags->operands()) {
      if(Flag->getNumOperands()!=3) continue;
      auto *N=dyn_cast<MDString>(Flag->getOperand(1));
      if(!N || N->getString()!=Name) continue;
      auto *B=mdconst::dyn_extract<ConstantInt>(Flag->getOperand(0));
      auto *V=mdconst::dyn_extract<ConstantInt>(Flag->getOperand(2));
      if(++Count!=1 || !B || !V || B->getZExtValue()!=Module::Error ||
         V->getZExtValue()!=Expected) Fail();
    }
    if(Count!=1) Fail();
  }
  SmallVector<CallInst *,4> Matches;
  for(auto &BB:F) for(auto &I:BB) if(auto *CI=dyn_cast<CallInst>(&I))
    if(CI->getCalledFunction() &&
       CI->getCalledFunction()->getName()=="__wasm_gnu_unwind_match_v1") Matches.push_back(CI);
  DominatorTree DT(F);
  auto OffsetBase=[&](Value *V,int64_t Offset,Value *Base) {
    APInt Actual(DL.getIndexTypeSizeInBits(V->getType()),0);
    return V->stripAndAccumulateConstantOffsets(DL,Actual,true)==Base &&
           Actual.getSExtValue()==Offset;
  };
  for(auto *CI:Matches) {
    if(!CI->getMetadata("wasm.gnu.setjmp.match.v2") || CI->arg_size()!=7 ||
       CI->getArgOperand(0)!=GNURecord) Fail();
    auto Bundle=CI->getOperandBundle(LLVMContext::OB_funclet);
    auto *Pad=Bundle?dyn_cast<CatchPadInst>(Bundle->Inputs[0]):nullptr;
    auto *Ret=dyn_cast<CatchReturnInst>(CI->getParent()->getTerminator());
    if(!Pad || !Ret || Ret->getCatchPad()!=Pad || CI->getNextNode()!=Ret) Fail();
    auto *Label=dyn_cast<CallInst>(CI->getArgOperand(2));
    auto *Env=dyn_cast<LoadInst>(CI->getArgOperand(1));
    auto *Version=dyn_cast<LoadInst>(CI->getArgOperand(5));
    auto *Handle=dyn_cast<PtrToIntInst>(CI->getArgOperand(6));
    auto *Raw=Handle?dyn_cast<CallInst>(Handle->getOperand(0)):nullptr;
    if(!Label || !Env || !Version || !Handle || !Raw ||
       Raw->getIntrinsicID()!=Intrinsic::wasm_catch || Raw->arg_size()!=1 ||
       !isa<ConstantInt>(Raw->getArgOperand(0)) ||
       cast<ConstantInt>(Raw->getArgOperand(0))->getZExtValue()!=WebAssembly::C_LONGJMP ||
       !Label->getCalledFunction() || Label->getCalledFunction()->getName()!="__wasm_setjmp_test" ||
       !Label->getMetadata("wasm.gnu.setjmp.test.v2") || Label->arg_size()!=2 ||
       Label->getArgOperand(0)!=Env || Label->getArgOperand(1)!=CI->getArgOperand(3) ||
       !OffsetBase(CI->getArgOperand(4),28,Env)) Fail();
    auto *Pred=CI->getParent()->getSinglePredecessor();
    auto *Edge=Pred?dyn_cast<BranchInst>(Pred->getTerminator()):nullptr;
    auto *Test=Edge&&Edge->isConditional()?dyn_cast<ICmpInst>(Edge->getCondition()):nullptr;
    if(!Test || Test->getPredicate()!=ICmpInst::ICMP_EQ || Test->getOperand(0)!=Label ||
       !PatternMatch::match(Test->getOperand(1),PatternMatch::m_Zero()) ||
       Edge->getSuccessor(1)!=CI->getParent()) Fail();
    // Both env and version come from the same authenticated resolver SSA;
    // mutable environment storage cannot manufacture a new captured version.
    Value *Payload=nullptr;
    for(auto &BB:F) for(auto &I:BB) if(auto *Resolve=dyn_cast<CallInst>(&I))
      if(Resolve->getCalledFunction() &&
         Resolve->getCalledFunction()->getName()=="__wasm_gnu_jump_delivery_resolve_v2" &&
         Resolve->arg_size()==1 && Resolve->getArgOperand(0)==Handle &&
         Resolve->getMetadata("wasm.gnu.tag1.resolve.v2")) {
        if(Payload) Fail(); Payload=Resolve;
      }
    auto *Resolve=dyn_cast_or_null<CallInst>(Payload);
    auto *Auth=Resolve?dyn_cast<BranchInst>(Resolve->getParent()->getTerminator()):nullptr;
    auto *NonNull=Auth&&Auth->isConditional()?dyn_cast<ICmpInst>(Auth->getCondition()):nullptr;
    if(!Resolve || !NonNull || NonNull->getPredicate()!=ICmpInst::ICMP_NE ||
       NonNull->getOperand(0)!=Payload || !isa<ConstantPointerNull>(NonNull->getOperand(1)) ||
       !DT.dominates(Auth->getSuccessor(0),Env->getParent()) ||
       !DT.dominates(Auth->getSuccessor(0),Version->getParent()) ||
       !OffsetBase(Env->getPointerOperand(),0,Payload) ||
       !OffsetBase(Version->getPointerOperand(),8,Payload)) Fail();
    IRBuilder<> B(CI); auto *P=B.getPtrTy(); auto *I32=B.getInt32Ty();
    auto Target=M.getOrInsertFunction("__wasm_gnu_unwind_target_v2",I32,P,P,I32,I32);
    cast<Function>(Target.getCallee())->addFnAttr(Attribute::NoUnwind);
    SmallVector<OperandBundleDef,1> Bundles{OperandBundleDef("funclet",Pad)};
    auto *Valid=B.CreateCall(Target,{CI->getArgOperand(4),Env,Version,Handle},Bundles);
    auto *Bad=B.CreateICmpEQ(Valid,B.getInt32(0));
    auto *Failure=SplitBlockAndInsertIfThen(Bad,CI,false);
    IRBuilder<> AB(Failure);
    AB.CreateCall(M.getOrInsertFunction("abort",AB.getVoidTy()),{},Bundles);
    AB.CreateUnreachable(); Failure->eraseFromParent();
    B.SetInsertPoint(CI);
    auto *Saved=B.CreateLoad(P,B.CreateConstGEP1_32(B.getInt8Ty(),CI->getArgOperand(4),12));
    auto *Restore=B.CreateCall(Intrinsic::getOrInsertDeclaration(&M,Intrinsic::stackrestore),
                              {Saved},Bundles);
    Restore->setMetadata("wasm.gnu.setjmp.restore.v2",MDNode::get(F.getContext(),{}));
    CI->eraseFromParent();
    DT.recalculate(F);
  }
  return !Matches.empty();
}
