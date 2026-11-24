#include <llvm/IR/IRBuilder.h>
#include <llvm/IR/Verifier.h>
#include <llvm/IR/IntrinsicInst.h>
#include <llvm/IRReader/IRReader.h>
#include <llvm/Bitcode/BitcodeWriter.h>
#include <llvm/Support/SourceMgr.h>
#include <llvm/Support/FileSystem.h>
#include <llvm/Support/raw_ostream.h>
#include <llvm/Transforms/Utils/BasicBlockUtils.h>
#include <fstream>
#include <map>
using namespace llvm;
// A finite prototype: every surviving definition and every external boundary
// must be explicitly assigned. No guessed PC and no uninstrumented callback.
int main(int argc,char **argv) {
 if(argc!=5&&argc!=6)return 2; LLVMContext C; SMDiagnostic E;
 auto M=parseIRFile(argv[1],E,C);if(!M){E.print(argv[0],errs());return 2;}
 std::ifstream map(argv[3]);std::map<std::string,unsigned> modules;std::string name;unsigned id;
 while(map>>name>>id)modules[name]=id;
 // Explicit, separately pinned native GNU boundaries cannot pass provenance
 // onward. Covered entries reject their callbacks unless separately adapted.
 std::map<std::string,bool> boundaries;
 if(argc==6){std::ifstream leaf(argv[5]);while(leaf>>name)boundaries[name]=true;}
 auto *P=PointerType::getUnqual(C);auto *I=Type::getInt32Ty(C);
 auto *D=StructType::get(I,I,I); // stable id, actual caller module, kind
 struct Site {CallBase *call;Function *owner;unsigned module;bool entry;};
 SmallVector<Site,64> sites;SmallVector<Function*,32> defs;
 for(auto &F:*M)if(!F.isDeclaration()) {
  auto m=modules.find(F.getName().str());if(m==modules.end()){errs()<<"uncovered definition "<<F.getName()<<"\n";return 3;}
  defs.push_back(&F);if(F.getName()==argv[4])sites.push_back({nullptr,&F,m->second,true});
  for(auto &BB:F)for(auto &N:BB)if(auto *CB=dyn_cast<CallBase>(&N)) {
   if(isa<IntrinsicInst>(CB))continue;
   if(CB->isInlineAsm()){errs()<<"inline asm boundary rejected\n";return 3;}
   if(auto *CI=dyn_cast<CallInst>(CB))if(CI->isTailCall()){errs()<<"tail call rejected\n";return 3;}
   auto *callee=CB->getCalledFunction();
   if(callee&&callee->isDeclaration()){
    if(boundaries.count(callee->getName().str()))continue;
    errs()<<"uncovered external "<<callee->getName()<<"\n";return 3;}
   sites.push_back({CB,&F,m->second,false});
  }
 }
 if(defs.empty()){errs()<<"no covered definitions\n";return 3;}
 // Actual separate per-module descriptor allocations, not executable ranges.
 std::map<unsigned,SmallVector<Constant*,32>> values;
 for(unsigned n=0;n<sites.size();++n)values[sites[n].module].push_back(ConstantStruct::get(D,{ConstantInt::get(I,n+1),ConstantInt::get(I,sites[n].module),ConstantInt::get(I,sites[n].entry?2:1)}));
 std::map<unsigned,GlobalVariable*> arrays;std::map<unsigned,unsigned> next;
 for(auto &[module,entries]:values){auto *A=ArrayType::get(D,entries.size());arrays[module]=new GlobalVariable(*M,A,true,GlobalValue::ExternalLinkage,ConstantArray::get(A,entries),"__native_callsites_"+std::to_string(module));arrays[module]->setAlignment(Align(4));}
 SmallVector<Constant*,64> tokens;
 for(auto &s:sites){auto *g=arrays[s.module];SmallVector<Constant*,2> indices{ConstantInt::get(I,0),ConstantInt::get(I,next[s.module]++)};tokens.push_back(ConstantExpr::getInBoundsGetElementPtr(g->getValueType(),g,indices));}
 auto *TokenArray=ArrayType::get(P,tokens.size());
 auto *OldTable=M->getNamedGlobal("__native_token_table");if(OldTable)OldTable->setName("__native_token_table.import");
 auto *TokenTable=new GlobalVariable(*M,TokenArray,true,GlobalValue::ExternalLinkage,ConstantArray::get(TokenArray,tokens),"__native_token_table");
 if(OldTable){OldTable->replaceAllUsesWith(TokenTable);OldTable->eraseFromParent();}
 auto *Count=M->getNamedGlobal("__native_token_count");
 if(Count){if(Count->getValueType()!=I)return 3;Count->setInitializer(ConstantInt::get(I,tokens.size()));}
 else new GlobalVariable(*M,I,true,GlobalValue::ExternalLinkage,ConstantInt::get(I,tokens.size()),"__native_token_count");
 auto *Pending=M->getNamedGlobal("__native_pending_caller");
 if(Pending){if(Pending->getValueType()!=P||!Pending->isThreadLocal()){errs()<<"incoherent pending TLS\n";return 3;}}
 else Pending=new GlobalVariable(*M,P,false,GlobalValue::ExternalLinkage,ConstantPointerNull::get(P),"__native_pending_caller",nullptr,GlobalVariable::LocalExecTLSModel);
 auto *Trap=Intrinsic::getOrInsertDeclaration(M.get(),Intrinsic::trap);
 // Address values in this helper are actual relocated function table pointers.
 auto *Validate=Function::Create(FunctionType::get(Type::getInt1Ty(C),{P},false),GlobalValue::InternalLinkage,"__native_valid_indirect",*M);
 auto *VB=BasicBlock::Create(C,"entry",Validate);IRBuilder<> V(VB);Value *Valid=V.getFalse();
 for(auto *F:defs)Valid=V.CreateOr(Valid,V.CreateICmpEQ(Validate->getArg(0),F));V.CreateRet(Valid);
 std::map<Function*,Value*> captures;
 for(auto *F:defs){IRBuilder<> B(&*F->getEntryBlock().getFirstInsertionPt());
  F->removeFnAttr(Attribute::Memory);F->removeFnAttr(Attribute::Speculatable);
  for(auto &BB:*F)for(auto &N:BB)if(auto *CB=dyn_cast<CallBase>(&N)){
   if(!isa<IntrinsicInst>(CB)){CB->removeFnAttr(Attribute::Memory);CB->removeFnAttr(Attribute::Speculatable);}
  }
  F->addFnAttr("disable-tail-calls","true");
  for(unsigned n=0;n<sites.size();++n)if(sites[n].entry&&sites[n].owner==F)B.CreateStore(tokens[n],Pending)->setVolatile(true);
  auto *Caller=B.CreateLoad(P,Pending,"native.actual.caller");Caller->setVolatile(true);captures[F]=Caller;
  auto *Consume=B.CreateStore(ConstantPointerNull::get(P),Pending);Consume->setVolatile(true);
  auto *Continue=Consume->getNextNode();auto *Bad=B.CreateICmpEQ(Caller,ConstantPointerNull::get(P));
  // Move the null check before the remaining original body, after consumption.
  if(!Continue)Continue=F->getEntryBlock().getTerminator();
  auto *Then=SplitBlockAndInsertIfThen(Bad,Continue,true);IRBuilder<> TB(Then);TB.CreateCall(Trap);
 }
 unsigned returns=0,indirects=0;
 for(auto *F:defs){SmallVector<CallInst*,8> RA;
  for(auto &BB:*F)for(auto &N:BB)if(auto *CI=dyn_cast<CallInst>(&N))if(CI->getCalledFunction()&&CI->getCalledFunction()->getIntrinsicID()==Intrinsic::returnaddress)RA.push_back(CI);
  for(auto *CI:RA){auto *Depth=dyn_cast<ConstantInt>(CI->getArgOperand(0));if(!Depth||!Depth->isZero()){errs()<<"nonzero return depth rejected\n";return 3;}
   IRBuilder<> B(CI);auto *Bad=B.CreateICmpEQ(captures[F],ConstantPointerNull::get(P));
   auto *Then=SplitBlockAndInsertIfThen(Bad,CI,true);IRBuilder<> TB(Then);TB.CreateCall(Trap);
   CI->replaceAllUsesWith(captures[F]);CI->eraseFromParent();++returns;
  }
 }
 for(unsigned n=0;n<sites.size();++n){auto &s=sites[n];if(s.entry)continue;auto *CB=s.call;
  if(!CB->getCalledFunction()){
   IRBuilder<> B(CB);auto *Good=B.CreateCall(Validate,{CB->getCalledOperand()});auto *Bad=B.CreateNot(Good);
   auto *Then=SplitBlockAndInsertIfThen(Bad,CB,true);IRBuilder<> TB(Then);TB.CreateCall(Trap);++indirects;
  }
  IRBuilder<> B(CB);B.CreateStore(tokens[n],Pending)->setVolatile(true);
 }
 for(auto *F:defs)for(auto &BB:*F)for(auto &N:BB)if(auto *CB=dyn_cast<CallBase>(&N)){
  auto *Callee=CB->getCalledFunction();
  if(Callee&&Callee->isDeclaration()&&boundaries.count(Callee->getName().str())){
   IRBuilder<> B(CB);B.CreateStore(ConstantPointerNull::get(P),Pending)->setVolatile(true);
  }
 }
 errs()<<"definitions="<<defs.size()<<" actual-callsite-descriptors="<<sites.size()<<" returnaddr="<<returns<<" checked-indirect="<<indirects<<"\n";
 if(verifyModule(*M,&errs()))return 4;std::error_code EC;raw_fd_ostream O(argv[2],EC,sys::fs::OF_None);if(EC)return 2;WriteBitcodeToFile(*M,O);return 0;
}
