import React, { useState, useEffect, createContext, useContext } from "react";
import ReactDOM from "react-dom/client";
import ListRecords from "../components/list-records";
import CreateRecords from "../components/create-records";
import UpdateRecord from "../components/update-record";
import GetRecord from "../components/get-record";
import "../styles/index.css";

// Create a context for widget data
const WidgetDataContext = createContext<any>(null);

// Hook to use widget data from context
const useWidgetDataFromContext = () => {
  return useContext(WidgetDataContext);
};

// Mock data for each component
const mockData = {
  "list-records": {
    baseId: "appTest123",
    tableId: "tblTest456",
    records: [
      {
        id: "recTest1",
        fields: {
          Name: "Test Record 1",
          Status: "Active",
          Created: "2024-01-01",
          Description: "This is a test record for preview",
        },
      },
      {
        id: "recTest2",
        fields: {
          Name: "Test Record 2",
          Status: "Inactive",
          Created: "2024-01-02",
          Description: "Another test record",
        },
      },
      {
        id: "recTest3",
        fields: {
          Name: "Test Record 3",
          Status: "Pending",
          Created: "2024-01-03",
          Description: "Third test record",
        },
      },
    ],
    view: "Grid View",
  },
  "create-records": {
    baseId: "appTest123",
    tableId: "tblTest456",
    fields: {
      Name: "",
      Status: "",
      Description: "",
    },
  },
  "update-record": {
    baseId: "appTest123",
    tableId: "tblTest456",
    recordId: "recTest1",
    record: {
      id: "recTest1",
      fields: {
        Name: "Test Record 1",
        Status: "Active",
        Created: "2024-01-01",
        Description: "This is a test record that can be updated",
      },
    },
  },
  "get-record": {
    baseId: "appTest123",
    tableId: "tblTest456",
    record: {
      id: "recTest1",
      fields: {
        Name: "Test Record 1",
        Status: "Active",
        Created: "2024-01-01",
        Description: "This is a detailed view of a single record",
        Attachments: [
          {
            url: "https://via.placeholder.com/150",
            filename: "placeholder.png",
            size: 1024,
          },
        ],
        Tags: ["Important", "Preview"],
      },
    },
  },
};

function App() {
  const [isDark, setIsDark] = useState(false);
  const [visibleComponents, setVisibleComponents] = useState<string[]>([]);

  useEffect(() => {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    setIsDark(prefersDark);
  }, []);

  useEffect(() => {
    // Update document class for Tailwind dark mode
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Update window.openai.theme for components that read it
    if ((window as any).openai) {
      (window as any).openai.theme = isDark ? "dark" : "light";
    }

    // Dispatch theme change event for components listening
    window.dispatchEvent(
      new CustomEvent("openai:theme-change", {
        detail: { theme: isDark ? "dark" : "light" },
      })
    );
  }, [isDark]);

  // Expose context to window for useWidgetProps to access
  useEffect(() => {
    (window as any).__WIDGET_DATA_CONTEXT__ = WidgetDataContext;
  }, []);

  // Mock OpenAI API for preview mode
  useEffect(() => {
    if (!(window as any).openai) {
      (window as any).openai = {
        theme: isDark ? "dark" : "light",
        displayMode: "inline",
        maxHeight: 600,
        toolInput: {},
        toolOutput: mockData["list-records"],
        toolResponseMetadata: null,
        widgetState: null,
        setWidgetState: async (state: any) => {
          console.log("[Mock] setWidgetState called:", state);
          (window as any).openai.widgetState = state;
          window.dispatchEvent(
            new CustomEvent("openai:set_globals", {
              detail: { globals: { widgetState: state } },
            })
          );
        },
        callTool: async (name: string, args: any) => {
          console.log("[Mock] callTool called:", name, args);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { result: `Successfully called ${name}` };
        },
        sendFollowUpMessage: async (args: any) => {
          console.log("[Mock] sendFollowUpMessage called:", args);
        },
        openExternal: (payload: any) => {
          console.log("[Mock] openExternal called:", payload);
          window.open(payload.href, "_blank");
        },
        requestDisplayMode: async (args: any) => {
          console.log("[Mock] requestDisplayMode called:", args);
          return { mode: args.mode };
        },
      };
    }

    // Update theme whenever isDark changes
    (window as any).openai.theme = isDark ? "dark" : "light";

    // Dispatch theme change event for components listening
    window.dispatchEvent(
      new CustomEvent("openai:set_globals", {
        detail: { globals: { theme: isDark ? "dark" : "light" } },
      })
    );
  }, [isDark]);

  // Render components sequentially to ensure each gets its own data
  useEffect(() => {
    const componentIds = components.map((c) => c.id);
    let currentIndex = 0;

    const renderNext = () => {
      if (currentIndex < componentIds.length) {
        const componentId = componentIds[currentIndex];
        setVisibleComponents((prev) => [...prev, componentId]);
        currentIndex++;

        // Small delay to ensure data is set before next component mounts
        if (currentIndex < componentIds.length) {
          setTimeout(renderNext, 150);
        }
      }
    };

    // Start rendering
    renderNext();
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  const components = [
    {
      id: "list-records",
      label: "List Records",
      Component: ListRecords,
      data: mockData["list-records"],
    },
    {
      id: "create-records",
      label: "Create Records",
      Component: CreateRecords,
      data: mockData["create-records"],
    },
    {
      id: "update-record",
      label: "Update Record",
      Component: UpdateRecord,
      data: mockData["update-record"],
    },
    {
      id: "get-record",
      label: "Get Record",
      Component: GetRecord,
      data: mockData["get-record"],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors duration-200 flex flex-col items-center p-8">
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={toggleTheme}
          className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 hover:scale-105 transition-all duration-200"
          aria-label="Toggle theme"
        >
          {isDark ? (
            <svg
              className="w-6 h-6 text-yellow-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
            </svg>
          ) : (
            <svg
              className="w-6 h-6 text-gray-700"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                fillRule="evenodd"
                d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Airtable MCP Widget Preview
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Preview all 5 UI components with theme toggle
        </p>
      </div>

      <div className="w-[760px] space-y-8">
        {components
          .filter(({ id }) => visibleComponents.includes(id))
          .map(({ id, label, Component, data }) => {
            // Create isolated component wrapper that maintains its own data
            const WidgetWrapper = () => {
              // Store data in ref and state to persist across re-renders
              const dataRef = React.useRef(data);
              const [componentData] = React.useState(data);
              dataRef.current = componentData;

              // Provide data through context
              React.useEffect(() => {
                // Also set in global location for compatibility
                (window as any).__WIDGET_PROPS__ = componentData;
                if ((window as any).openai) {
                  (window as any).openai.toolOutput = {
                    structuredContent: componentData,
                  };
                }
              }, [componentData]);

              // Set data on every render to ensure it's available
              (window as any).__WIDGET_PROPS__ = componentData;
              if ((window as any).openai) {
                (window as any).openai.toolOutput = {
                  structuredContent: componentData,
                };
              }

              return (
                <WidgetDataContext.Provider value={componentData}>
                  <Component />
                </WidgetDataContext.Provider>
              );
            };

            return (
              <div key={id}>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {label}
                </h2>
                <WidgetWrapper />
              </div>
            );
          })}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
