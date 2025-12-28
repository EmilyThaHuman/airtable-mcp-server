import { useOpenAiGlobal } from "./use-openai-global";
import { useEffect, useState, useContext, Context } from "react";

// Global context reference (set by preview mode)
declare global {
  interface Window {
    __WIDGET_DATA_CONTEXT__?: Context<any>;
  }
}

export function useWidgetProps<T extends Record<string, unknown>>(
  defaultState?: T | (() => T)
): T {
  const toolOutput = useOpenAiGlobal("toolOutput") as any;
  
  // Try to get data from context first (for preview mode)
  // Check if we're in preview mode and context is available
  let contextData: T | undefined = undefined;
  if (typeof window !== 'undefined' && (window as any).__WIDGET_DATA_CONTEXT__) {
    try {
      const ctx = (window as any).__WIDGET_DATA_CONTEXT__;
      contextData = useContext(ctx) as T;
    } catch (e) {
      // Context not available, continue with other methods
    }
  }
  
  // Read props directly from window on EVERY render (for preview mode with multiple components)
  const currentProps = typeof window !== 'undefined' 
    ? ((window as any).__WIDGET_PROPS__ as T) || 
      ((window as any).openai?.toolOutput?.structuredContent as T)
    : undefined;
  
  // Also check for props injected via window.__WIDGET_PROPS__ (used by ZeroTwo renderer)
  // Use state for reactivity, but prioritize currentProps on each render
  const [injectedProps, setInjectedProps] = useState<T | undefined>(currentProps);

  useEffect(() => {
    // Listen for props updates
    const checkProps = () => {
      if (typeof window !== 'undefined') {
        const props = (window as any).__WIDGET_PROPS__ || 
                     (window as any).openai?.toolOutput?.structuredContent;
        if (props) {
          setInjectedProps(props as T);
        }
      }
    };
    
    // Check immediately
    checkProps();
    
    // Also listen for custom events
    const handlePropsUpdate = () => {
      checkProps();
    };
    
    window.addEventListener('widget-props-update', handlePropsUpdate);
    
    // Poll for changes (for preview mode with multiple components)
    const interval = setInterval(checkProps, 50);
    
    return () => {
      window.removeEventListener('widget-props-update', handlePropsUpdate);
      clearInterval(interval);
    };
  }, []);

  // Priority order: context data > currentProps > injectedProps
  // Context data is highest priority for preview mode (component-specific)
  const propsToUse = contextData || currentProps || injectedProps;
  
  // Extract structuredContent from toolOutput
  // toolOutput can be structured in multiple ways:
  // 1. toolOutput.structuredContent (direct property)
  // 2. toolOutput.result.structuredContent (nested in result)
  // 3. toolOutput itself is the structuredContent (already extracted)
  // 4. null/undefined if tool hasn't completed yet
  let props: T | undefined;
  
  // First check context/current/injected props (highest priority)
  if (propsToUse) {
    props = propsToUse;
  }
  // Then check toolOutput
  else if (toolOutput) {
    // Check if toolOutput has structuredContent property
    if (toolOutput.structuredContent) {
      props = toolOutput.structuredContent as T;
    } 
    // Check if nested in result property (common in some widget systems)
    else if (toolOutput.result?.structuredContent) {
      props = toolOutput.result.structuredContent as T;
    }
    // Check if toolOutput itself is the structuredContent (already extracted)
    // Look for common properties that indicate it's the structured content
    else if (
      toolOutput.query !== undefined || 
      toolOutput.results !== undefined ||
      toolOutput.properties !== undefined ||
      toolOutput.designs !== undefined ||
      toolOutput.courses !== undefined ||
      toolOutput.hotels !== undefined ||
      toolOutput.flights !== undefined ||
      toolOutput.bookings !== undefined ||
      toolOutput.diagram !== undefined ||
      toolOutput.records !== undefined ||
      toolOutput.baseId !== undefined ||
      toolOutput.tableId !== undefined
    ) {
      props = toolOutput as T;
    }
  }

  const fallback =
    typeof defaultState === "function"
      ? (defaultState as () => T)()
      : defaultState;

  return (props ?? fallback) as T;
}

