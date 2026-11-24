// Direct GNU jump calls remain in the caller frame. LLVM 22 Wasm EH/SjLj
// lowers only setjmp, so expose that intrinsic after genuine GNU mask saving.
#include <llvm/IR/IRBuilder.h>
#include <llvm/IR/Module.h>
#include <llvm/IR/Instructions.h>
#include <llvm/IR/Verifier.h>
#include <llvm/IR/IntrinsicInst.h>
#include <llvm/IRReader/IRReader.h>
#include <llvm/Bitcode/BitcodeWriter.h>
#include <llvm/Support/SourceMgr.h>
#include <llvm/Support/FileSystem.h>
#include <llvm/Support/raw_ostream.h>
using namespace llvm;
int main(int argc,char **argv){
 if(argc!=3)return 2;LLVMContext C;SMDiagnostic E;
 auto M=parseIRFile(argv[1],E,C);if(!M){E.print(argv[0],errs());return 2;}
 auto *P=PointerType::getUnqual(C);auto *I=Type::getInt32Ty(C);
 auto SJ=M->getOrInsertFunction("setjmp",FunctionType::get(I,{P},false));
 auto Save=M->getOrInsertFunction("__sigjmp_save",FunctionType::get(I,{P,I},false));
 auto Prep=M->getOrInsertFunction("__wasm_jmp_prepare",FunctionType::get(Type::getVoidTy(C),{P,P},false));
 auto LJ=M->getOrInsertFunction("__libc_siglongjmp",FunctionType::get(Type::getVoidTy(C),{P,I},false));
 for(auto &F:*M){auto N=F.getName();if((N=="longjmp"||N=="_longjmp"||N=="siglongjmp")&&F.isDeclaration()){
 if(F.getFunctionType()!=cast<Function>(LJ.getCallee())->getFunctionType()){errs()<<"invalid longjmp type\n";return 3;}
 F.replaceAllUsesWith(LJ.getCallee());
 }}
 SmallVector<CallInst*,16> calls;
 for(auto &F:*M)for(auto &B:F)for(auto &N:B)if(auto *Call=dyn_cast<CallInst>(&N))calls.push_back(Call);
 for(auto *Call:calls){auto *F=Call->getCalledFunction();if(!F)continue;StringRef N=F->getName();
 if(N=="__sigsetjmp"||N=="_setjmp"||N=="setjmp"){
 IRBuilder<> B(Call);Value *Env=Call->getArgOperand(0);Value *Mask=N=="__sigsetjmp"?Call->getArgOperand(1):ConstantInt::get(I,N=="setjmp"?1:0);
 B.CreateCall(Save,{Env,Mask});auto *SS=Intrinsic::getOrInsertDeclaration(M.get(),Intrinsic::stacksave,{P});B.CreateCall(Prep,{Env,B.CreateCall(SS)});
 auto *New=B.CreateCall(SJ,{Env});New->addFnAttr(Attribute::ReturnsTwice);New->setDebugLoc(Call->getDebugLoc());Call->replaceAllUsesWith(New);Call->eraseFromParent();
 }else if((N=="longjmp"||N=="_longjmp"||N=="siglongjmp")&&F->isDeclaration()){
 Call->setCalledFunction(LJ);Call->removeFnAttr(Attribute::NoUnwind);
 }
 }
 for(auto &F:*M){
 if(!F.isDeclaration())F.removeFnAttr(Attribute::NoUnwind);
 for(auto &BB:F)for(auto &Inst:BB)if(auto *CB=dyn_cast<CallBase>(&Inst))if(!isa<IntrinsicInst>(CB))CB->removeFnAttr(Attribute::NoUnwind);
 StringRef N=F.getName();if(N.contains("longjmp")||N=="setjmp"){
 F.removeFnAttr(Attribute::NoUnwind);for(auto *U:F.users())if(auto *CB=dyn_cast<CallBase>(U))CB->removeFnAttr(Attribute::NoUnwind);
 }if(N=="__sigsetjmp"||N=="_setjmp"||N=="setjmp"){
 for(auto *U:F.users())if(!isa<CallInst>(U)){errs()<<"unsupported indirect/escaping setjmp: "<<N<<"\n";return 3;}
 }}
 if(verifyModule(*M,&errs()))return 4;
 std::error_code EC;raw_fd_ostream O(argv[2],EC,sys::fs::OF_None);if(EC)return 2;WriteBitcodeToFile(*M,O);return 0;
}
