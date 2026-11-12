import { useEffect, useState } from "react";
import {
  readConfigurationStep,
  storeConfigurationStep,
} from "./configurationUIStorage";

export function useConfigurationSteps(connectionManaged: boolean | undefined) {
  const [storedStep, setStep] = useState(readConfigurationStep);
  const step = connectionManaged !== false && storedStep === 0 ? 1 : storedStep;
  const persistedStep = connectionManaged === undefined ? storedStep : step;
  const [suggestionsVisited, setSuggestionsVisited] = useState(step === 3);
  useEffect(() => {
    if (connectionManaged && step !== storedStep) setStep(step);
  }, [connectionManaged, step, storedStep]);
  useEffect(() => storeConfigurationStep(persistedStep), [persistedStep]);
  useEffect(() => {
    if (step === 3) setSuggestionsVisited(true);
  }, [step]);
  return {
    step,
    setStep,
    suggestionsVisited,
    reset: () => {
      setSuggestionsVisited(false);
      setStep(connectionManaged ? 1 : 0);
    },
  };
}
