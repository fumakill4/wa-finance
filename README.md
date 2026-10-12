# WA-Finance 💬💰

WA-Finance is a streamlined, automated financial tracking system that bridges the gap between your daily WhatsApp chats and your business dashboard. Instead of manually logging expenses or incomes into a spreadsheet, you can simply text your dedicated WhatsApp bot, and it automatically syncs everything in real-time.

## 🚀 Why WA-Finance?

Managing finances shouldn't feel like a chore. We built WA-Finance to make bookkeeping as natural as sending a chat to a friend. By leveraging a headless WhatsApp connection and a lightning-fast React frontend, this project delivers a seamless, zero-friction accounting experience.

## ✨ Key Features

- **Conversational Accounting**: Log transactions simply by chatting with the bot. No extra app installations required for your staff or partners.
- **Real-Time Sync**: Every message processed by the backend immediately updates the central database and reflects on the web dashboard.
- **Headless WhatsApp Engine**: Powered by the robust Baileys library for seamless QR-based WhatsApp Web authentication.
- **Modern Web Dashboard**: A clean, responsive Vite + React frontend for analyzing cash flow, managing records, and viewing connection status.
- **Open-Source Ready (Blank Slate)**: Stripped of personal data and designed as a flexible template for anyone to clone, configure, and deploy for their own business.

## 🛠️ Tech Stack

**Backend (The Brains)**:
- Node.js & Express
- `@whiskeysockets/baileys` (WhatsApp Web API)
- dotenv for environment management

**Frontend (The Face)**:
- React (powered by Vite)
- Modern CSS for clean UI components

## 📦 Getting Started

### Prerequisites
- Node.js (v18 or higher recommended)
- A dedicated WhatsApp number to act as the bot
- Your preferred cloud database (e.g., Firebase) to store the records

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/hittoukiri-design/wa-finance.git
   cd wa-finance
   ```

2. **Setup the Backend (WhatsApp Bot)**
   ```bash
   cd backend
   npm install
   ```
   *Create a `.env` file in the `backend` folder and add your database credentials.*
   ```bash
   node index.js
   ```
   *Scan the QR code printed in the terminal using your WhatsApp linked devices to wake the bot up.*

3. **Setup the Frontend (Dashboard)**
   Open a new terminal window:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   *Navigate to the localhost URL provided by Vite to view your dashboard.*

## 🤝 Contributing
This project is open-source and intended as a flexible "Blank Slate" template. Feel free to fork it, adapt it to your own specific business logic, and submit pull requests!

## 📄 License
MIT License

---
© 2026 WA Finance App created by i729
