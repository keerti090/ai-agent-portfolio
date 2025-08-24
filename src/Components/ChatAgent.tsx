import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../style.css";

interface ChatAgentProps {
  messages: { role: string; content: string }[];
  setMessages: React.Dispatch<React.SetStateAction<{ role: string; content: string }[]>>;
}

const ChatAgent: React.FC<ChatAgentProps> = ({ messages, setMessages }) => {
  const [loading, setLoading] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

  const containerRef = useRef<HTMLDivElement>(null);

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

  // --- API Call ---
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === "user") {
      handleSend(messages[messages.length - 1].content);
    }
  }, [messages]);

  const handleSend = async (query: string) => {
    setLoading(true);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:5173",
          "X-Title": "keerti-portfolio-agent"
        },
        body: JSON.stringify({
          model: "tngtech/deepseek-r1t2-chimera:free",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `You are Kairo, Keerti's AI portfolio assistant.

**Your Goal:**
- Introduce Keerti as a product designer & developer.
- Answer questions about her skills, design approach, and projects.

**Portfolio Context:**
- Skills: UX design, UI design, React, design systems, prototyping.
- Projects: Search Global & Module, Quote Request Flow, Design System, Alleo, MedConnect, LMS for Drivers.
- Background: Combines design & development to craft intuitive user experiences.

**Response Style:**
- Be warm yet professional.
- Use headers (##), emojis, and bullet points where helpful.
- Keep replies clear and concise.
- If unsure, say: "I don’t have that detail yet, but Keerti can share more."`
            },
            ...messages
          ]
        })
      });

      const data = await response.json();

      if (response.ok && data.choices?.length) {
        const { role, content } = data.choices[0].message;
        setMessages((prev) => [...prev, { role, content }]);
      } else {
        console.error("API Error:", data);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "⚠️ Something went wrong. Please try again." }
        ]);
      }
    } catch (err) {
      console.error("Network error:", err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Network error. Try again later." }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container" ref={containerRef} onScroll={handleScroll}>
      {messages.map((msg, idx) => (
        <div key={idx} className={`message ${msg.role}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {msg.content}
          </ReactMarkdown>
        </div>
      ))}
      {loading && <div className="message assistant">💬 Typing...</div>}

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
