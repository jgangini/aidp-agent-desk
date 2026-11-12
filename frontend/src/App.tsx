import { Desk } from "./features/desk/Desk";
import "./styles.css";
import { AccountGate } from "./shared/AccountGate";

export function App() {
  return (
    <AccountGate>
      <Desk />
    </AccountGate>
  );
}
