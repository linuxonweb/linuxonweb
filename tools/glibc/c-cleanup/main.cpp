// Private driver entry for the unchanged LLVM 22.1.8 clang_main.
#include "llvm/Support/LLVMDriver.h"
int clang_main(int, char **, const llvm::ToolContext &);
int main(int argc, char **argv) {
  return clang_main(argc, argv, {argv[0], "clang", false});
}
