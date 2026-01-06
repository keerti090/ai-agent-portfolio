// import React, { useState, useRef, useEffect } from "react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import "../style.css";

// interface ChatAgentProps {
//   messages: { role: string; content: string }[];
//   setMessages: React.Dispatch<React.SetStateAction<{ role: string; content: string }[]>>;
// }

// const ChatAgent: React.FC<ChatAgentProps> = ({ messages, setMessages }) => {
//   const [loading, setLoading] = useState(false);
//   const [showScrollButton, setShowScrollButton] = useState(false);
//   const apiKey = import.meta.env.OPENAI_API_KEY;

//   const containerRef = useRef<HTMLDivElement>(null);

//   // --- Scroll Behavior ---
//   useEffect(() => {
//     if (containerRef.current) {
//       containerRef.current.scrollTop = containerRef.current.scrollHeight;
//     }
//   }, [messages]);

//   const handleScroll = () => {
//     if (!containerRef.current) return;
//     const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
//     const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
//     setShowScrollButton(!isAtBottom);
//   };

//   const scrollToBottom = () => {
//     if (containerRef.current) {
//       containerRef.current.scrollTo({
//         top: containerRef.current.scrollHeight,
//         behavior: "smooth",
//       });
//     }
//   };

//   // --- API Call ---
//   useEffect(() => {
//     if (messages.length > 0 && messages[messages.length - 1].role === "user") {
//       handleSend(messages[messages.length - 1].content);
//     }
//   }, [messages]);

//   const handleSend = async (query: string) => {
//     setLoading(true);
//     try {
//       const response = await fetch("http://localhost:3001/api/chat", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json"
//         },
//         body: JSON.stringify({
//           model: "tngtech/deepseek-r1t2-chimera:free",
//           temperature: 0.2,
//           messages: [
//             {
//               role: "system",
//               content: `You are Kairo, Keerti's AI portfolio assistant.

// **Your Goal:**
// - Introduce Keerti as a product designer & developer.
// - Answer questions about her skills, design approach, and projects.

// **Portfolio Context:**
// - Skills: UX design, UI design, React, design systems, prototyping.
// - Projects: Search Global & Module, Quote Request Flow, Design System, Alleo, MedConnect, LMS for Drivers.
// - Background: Combines design & development to craft intuitive user experiences.

// **Response Style:**
// - Be warm yet professional.
// - Use headers (##), emojis, and bullet points where helpful.
// - Keep replies clear and concise.
// - If unsure, say: "I don’t have that detail yet, but Keerti can share more."`
//             },
//             ...messages
//           ]
//         })
//       });
//       console.log("APU key: ", import.meta.env.VITE_OPENROUTER_API_KEY)
//       const data = await response.json();

//       if (response.ok && data.choices?.length) {
//         const { role, content } = data.choices[0].message;
//         setMessages((prev) => [...prev, { role, content }]);
//       } else {
//         console.error("API Error:", data);
//         setMessages((prev) => [
//           ...prev,
//           { role: "assistant", content: "⚠️ Something went wrong. Please try again." }
//         ]);
//       }
//     } catch (err) {
//       console.error("Network error:", err);
//       setMessages((prev) => [
//         ...prev,
//         { role: "assistant", content: "⚠️ Network error. Try again later." }
//       ]);
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="chat-container" ref={containerRef} onScroll={handleScroll}>
//       {messages.map((msg, idx) => (
//         <div key={idx} className={`message ${msg.role}`}>
//           <ReactMarkdown remarkPlugins={[remarkGfm]}>
//             {msg.content}
//           </ReactMarkdown>
//         </div>
//       ))}
//       {loading && <div className="message assistant">💬 Typing...</div>}

//       {/* Floating Scroll-to-Bottom Button */}
//       {showScrollButton && (
//         <div className="scroll-to-bottom show" onClick={scrollToBottom}>
//           ↓
//         </div>
//       )}
//     </div>
//   );
// };

// export default ChatAgent;

import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import "../style.css";
import { apiUrl } from "../lib/api";

interface ChatAgentProps {
  messages: { role: string; content: string }[];
  setMessages: React.Dispatch<React.SetStateAction<{ role: string; content: string }[]>>;
}

const ChatAgent: React.FC<ChatAgentProps> = ({ messages, setMessages }) => {
  const [loading, setLoading] = useState(false);
  const [slowNetworkOrColdStart, setSlowNetworkOrColdStart] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const slowTimerRef = useRef<number | null>(null);

  // Custom markdown components for rich media
  const markdownComponents: Components = {
    img: ({ node, ...props }) => {
      void node;
      return (
        <img
          {...props}
          className="markdown-image"
          loading="lazy"
          alt={props.alt || "Portfolio image"}
        />
      );
    },
    video: ({ node, ...props }) => {
      void node;
      return (
        <video
          {...props}
          className="markdown-video"
          controls
          playsInline
        />
      );
    },
    a: ({ node, ...props }) => {
      void node;
      const href = props.href || "";
      // Check if link is to an image or video
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(href);
      const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(href);
      
      if (isImage) {
        return (
          <img
            src={href}
            alt={props.children?.toString() || "Portfolio image"}
            className="markdown-image"
            loading="lazy"
          />
        );
      }
      
      if (isVideo) {
        return (
          <video
            src={href}
            className="markdown-video"
            controls
            playsInline
          />
        );
      }
      
      return (
        <a
          {...props}
          target="_blank"
          rel="noopener noreferrer"
          className="markdown-link"
        />
      );
    },
  };

  // --- Scroll Behavior ---
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
    setShowScrollButton(!isAtBottom);
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const handleSend = useCallback(async (query: string) => {
    setLoading(true);
    setSlowNetworkOrColdStart(false);

    if (slowTimerRef.current) {
      window.clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
    // If the request takes a few seconds, it’s often a Render free-plan cold start.
    slowTimerRef.current = window.setTimeout(() => {
      setSlowNetworkOrColdStart(true);
    }, 3500);

    try {
      const response = await fetch(apiUrl("/ask"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: query }),
      });
      console.log("Sent query:", response);

      const data = await response.json();

      if (response.ok && data.answer) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
      } else {
        console.error("API Error:", data);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Something went wrong. Response:\n${JSON.stringify(data)}`,
          },
        ]);
      }
    } catch (err: unknown) {
      console.error("Network error:", err);
      const fallbackMessage =
        err instanceof Error ? `⚠️ Network error: ${err.message}` : "⚠️ Network error. Try again later.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: fallbackMessage },
      ]);
    } finally {
      setLoading(false);
      if (slowTimerRef.current) {
        window.clearTimeout(slowTimerRef.current);
        slowTimerRef.current = null;
      }
    }
  }, [setMessages]);

  // --- Trigger API when user message is added ---
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === "user") {
      handleSend(messages[messages.length - 1].content);
    }
  }, [messages, handleSend]);

  return (
    <div className="chat-container" ref={containerRef} onScroll={handleScroll}>
      {messages.map((msg, idx) => (
        <div key={idx} className={`message ${msg.role}`}>
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
      ))}

      {loading && (
        <div className="message assistant is-typing" role="status" aria-live="polite">
          <div className="typing-indicator">
            <div className="typing-title">
              {slowNetworkOrColdStart ? "Waking things up…" : "Kairo is thinking…"}
            </div>
            <div className="typing-subtitle">
              {slowNetworkOrColdStart
                ? "Free hosting can take ~1 min on the first message. Thanks for your patience."
                : "One sec — I’ll reply shortly."}
            </div>
            <div className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}

      {/* Floating Scroll-to-Bottom Button */}
      {showScrollButton && (
        <div className="scroll-to-bottom show" onClick={scrollToBottom}>
          ↓
        </div>
      )}
    </div>
  );
};

export default ChatAgent;
