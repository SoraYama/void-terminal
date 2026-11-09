import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountRequestError, useAccount } from "../../src/lib/use-account";

const channel = new BroadcastChannel("void-terminal-account");
channel.onmessage = ({ data }) => {
  document.querySelector("#broadcast")!.textContent = data.type;
};

function ControllerFixture() {
  const [identity, setIdentity] = useState("pending");
  const [failure, setFailure] = useState("");
  const controller = useAccount(next => setIdentity(next === undefined ? "pending" : next ?? "signed-out"), true);
  return createElement("main", null,
    createElement("output", { id: "identity" }, identity),
    createElement("output", { id: "risk" }, controller.account?.risk?.status),
    createElement("output", { id: "failure" }, failure),
    createElement("button", {
      onClick: () => {
        void controller.verifyDevice("fixture-token").catch(cause => {
          setFailure(cause instanceof AccountRequestError ? cause.code : "unexpected-error");
        });
      },
    }, "Verify device"),
  );
}
createRoot(document.querySelector("#fixture")!).render(createElement(ControllerFixture));
