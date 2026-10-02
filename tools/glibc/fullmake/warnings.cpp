// Preserve GNU warning/stub metadata without changing GNU source or runtime.
#include <llvm/IR/Module.h>
#include <llvm/IR/Constants.h>
#include <llvm/IR/Verifier.h>
#include <llvm/IRReader/IRReader.h>
#include <llvm/Bitcode/BitcodeWriter.h>
#include <llvm/Support/SourceMgr.h>
#include <llvm/Support/FileSystem.h>
#include <llvm/Support/raw_ostream.h>
#include <set>
#include <map>
#include <sstream>
#include <regex>
using namespace llvm;
int main(int argc,char **argv){
 if(argc!=3)return 2;LLVMContext C;SMDiagnostic E;
 auto M=parseIRFile(argv[1],E,C);if(!M){E.print(argv[0],errs());return 2;}
 std::set<std::string> warnings,stubs;std::istringstream S(M->getModuleInlineAsm());std::string line;
 std::regex section(R"(^\.section \.gnu\.(warning|glibc-stub)\.([A-Za-z_][A-Za-z0-9_]*)$)");
 while(std::getline(S,line)){
  if(line.empty())continue;std::smatch match;
  if(!std::regex_match(line,match,section)){errs()<<"unsupported GNU module assembly: "<<line<<"\n";return 3;}
  std::string previous;if(!std::getline(S,previous)||previous!="\t.previous"){errs()<<"unpaired GNU metadata section\n";return 3;}
  auto &names=match[1]=="warning"?warnings:stubs;
  if(!names.insert(match[2]).second){errs()<<"duplicate GNU metadata section\n";return 3;}
 }
 std::map<std::string,GlobalVariable*> globals;
 auto *used=M->getGlobalVariable("llvm.used");ConstantArray *array=nullptr;
 if(used){array=dyn_cast<ConstantArray>(used->getInitializer());if(!array){errs()<<"unsupported llvm.used initializer\n";return 3;}}
 for(auto &G:M->globals())if(G.getSection().starts_with(".gnu.")){
  std::string name=G.getName().str();StringRef prefix="__evoke_link_warning_";
  if(!StringRef(name).starts_with(prefix)){errs()<<"unsupported GNU metadata global: "<<name<<"\n";return 3;}
  std::string symbol=name.substr(prefix.size());
  std::string expected=".gnu.warning."+symbol+"\n\t#";
  if(G.getSection()!=expected||!warnings.count(symbol)||!G.isConstant()||!G.hasInternalLinkage()){
   errs()<<"unexpected GNU warning global/section: "<<name<<"\n";return 3;
  }
  auto *data=dyn_cast<ConstantDataArray>(G.getInitializer());
  if(!data||!data->isCString()||!array){errs()<<"unsupported GNU warning bytes\n";return 3;}
  // GNU used attribute must be its only reference; runtime addresses are invalid.
  if(G.getNumUses()!=1||*G.user_begin()!=array||array->getNumUses()!=1||*array->user_begin()!=used){
   errs()<<"runtime/escaping GNU warning global: "<<name<<"\n";return 3;
  }
  globals[symbol]=&G;
 }
 if(globals.size()!=warnings.size()){errs()<<"missing GNU warning text\n";return 3;}
 for(auto &name:stubs)if(!warnings.count(name)){errs()<<"stub marker has no GNU warning\n";return 3;}
 if(warnings.empty()){
  // No changes to ordinary units; unknown module asm already rejected above.
 }else{
  auto *metadata=M->getOrInsertNamedMetadata("wasm.custom_sections");
  for(auto &[name,G]:globals){
   auto *data=cast<ConstantDataArray>(G->getInitializer());
   metadata->addOperand(MDNode::get(C,{MDString::get(C,".gnu.warning."+name),MDString::get(C,data->getAsString())}));
   if(stubs.count(name))metadata->addOperand(MDNode::get(C,{MDString::get(C,".gnu.glibc-stub."+name),MDString::get(C,"")}));
   errs()<<"preserved GNU warning "<<name<<" bytes="<<data->getNumElements()<<" stub="<<stubs.count(name)<<"\n";
  }
  SmallVector<Constant*,8> kept;
  for(auto &operand:array->operands()){
   auto *value=cast<Constant>(operand.get());bool marker=false;
   for(auto &[name,G]:globals)if(value->stripPointerCasts()==G)marker=true;
   if(!marker)kept.push_back(value);
  }
  used->eraseFromParent();array->destroyConstant();
  if(!kept.empty()){
   auto *ty=ArrayType::get(PointerType::getUnqual(C),kept.size());
   auto *replacement=new GlobalVariable(*M,ty,false,GlobalValue::AppendingLinkage,ConstantArray::get(ty,kept),"llvm.used");replacement->setSection("llvm.metadata");
  }
  for(auto &[name,G]:globals){if(!G->use_empty()){errs()<<"unexpected surviving marker use\n";return 3;}G->eraseFromParent();}
  M->setModuleInlineAsm("");
 }
 if(verifyModule(*M,&errs()))return 4;
 std::error_code EC;raw_fd_ostream O(argv[2],EC,sys::fs::OF_None);if(EC)return 2;WriteBitcodeToFile(*M,O);return 0;
}
