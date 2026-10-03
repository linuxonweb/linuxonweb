// Separate module4 audit; run once before physical register replacement and
// once after CFGStackify has created its genuine guard/escape calls.
namespace {
class WebAssemblyGNUCallAudit final : public MachineFunctionPass {
public:
  static char ID;
  WebAssemblyGNUCallAudit() : MachineFunctionPass(ID) {}
  bool runOnMachineFunction(MachineFunction &MF) override {
    if (!GNUForcedAdmission) return false;
    if (MF.getFunction().getFnAttribute("wasm-gnu-frame-records").getValueAsString() != "4")
      report_fatal_error("GNU call audit encountered an unadmitted function");
    auto &MRI = MF.getRegInfo();
    auto Origin = [&](Register R, const MachineInstr *At) {
      // RegColoring has left SSA before the second audit. Identify actual
      // reaching definitions, never register-name equality across value epochs.
      for (unsigned N = 0; N != 32 && R.isVirtual(); ++N) {
        const MachineInstr *Def = nullptr;
        auto It = At->getIterator();
        auto &Block = *At->getParent();
        while (It != Block.begin()) {
          --It;
          for (auto &MO : It->defs())
            if (MO.isReg() && MO.getReg() == R) { Def = &*It; break; }
          if (Def) break;
        }
        if (!Def) {
          auto *Unique = MRI.getUniqueVRegDef(R);
          // A unique entry definition dominates every executable block. Other
          // cross-block definitions are accepted only while MIR remains SSA.
          if (Unique && (MRI.isSSA() || (Unique->getParent() == &MF.front() &&
                                       At->getParent() != &MF.front()))) Def = Unique;
        }
        if (!Def) return static_cast<const MachineInstr *>(nullptr);
        if (!(Def->isCopy() || Def->getOpcode() == WebAssembly::COPY_I32) ||
            !Def->getOperand(1).isReg()) return Def;
        R = Def->getOperand(1).getReg(); At = Def;
      }
      return static_cast<const MachineInstr *>(nullptr);
    };
    for (auto &BB : MF) {
      const MachineInstr *Pending = nullptr;
      for (auto &MI : BB) {
        if (!MI.isCall()) continue;
        const auto &Target = WebAssembly::getCalleeOp(MI);
        StringRef Name;
        if (Target.isGlobal()) Name = Target.getGlobal()->getName();
        if (Target.isSymbol()) Name = Target.getSymbolName();
        if (Name == "__wasm_gnu_frame_admit_call_v1") {
          if (Pending) report_fatal_error("GNU call audit found an unconsumed admission");
          for (auto &MO : MI.explicit_uses()) {
            if (!MO.isReg()) continue;
            if (Pending) report_fatal_error("GNU call audit found ambiguous admission argument");
            Pending = Origin(MO.getReg(), &MI);
          }
          if (!Pending)
            report_fatal_error("GNU call admission lacks actual stable function identity");
          continue;
        }
        // These compiler-owned operations have independent exact record/SP and
        // binding audits; they are not an exemption for arbitrary provider names.
        if (Name == "__wasm_gnu_frame_enter_v1" || Name == "__wasm_gnu_frame_leave_v1" ||
            Name == "__wasm_gnu_frame_commit_sp_v1" || Name == "__wasm_gnu_unwind_bind_v1") {
          if (Pending) report_fatal_error("GNU compiler operation splits call admission");
          continue;
        }
        if (!Pending) report_fatal_error("GNU machine-created call lacks actual admission");
        bool Matches = false;
        if (Target.isReg()) {
          Matches = Origin(Target.getReg(), &MI) == Pending;
        } else {
          auto *Def = Pending;
          if (Def && Def->getOpcode() == WebAssembly::CONST_I32) {
            const auto &Identity = Def->getOperand(1);
            Matches = (Identity.isGlobal() && Target.isGlobal() &&
                Identity.getGlobal() == Target.getGlobal() && Identity.getOffset() == 0 &&
                Target.getOffset() == 0) || (Identity.isSymbol() && Target.isSymbol() &&
                StringRef(Identity.getSymbolName()) == Target.getSymbolName());
          }
        }
        if (!Matches) report_fatal_error("GNU admission does not name actual machine call target");
        Pending = nullptr;
      }
      if (Pending) report_fatal_error("GNU admission crosses an unverified CFG edge");
    }
    return false;
  }
};
}
char WebAssemblyGNUCallAudit::ID = 0;
FunctionPass *llvm::createWebAssemblyGNUCallAudit() { return new WebAssemblyGNUCallAudit(); }
