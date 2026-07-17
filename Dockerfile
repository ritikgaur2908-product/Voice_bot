# Use official Node.js runtime
FROM node:20-alpine

WORKDIR /app

# Copy dependency configs
COPY mcp-server/package*.json ./mcp-server/
COPY voice-agent/package*.json ./voice-agent/

# Install dependencies
RUN cd mcp-server && npm install
RUN cd voice-agent && npm install

# Copy source code
COPY mcp-server ./mcp-server
COPY voice-agent ./voice-agent

# Build MCP server (so that voice-agent can resolve ../mcp-server/dist/index.js)
RUN cd mcp-server && npm run build

# Build voice agent
RUN cd voice-agent && npm run build

# Expose port
EXPOSE 3001

# Start the voice agent backend
WORKDIR /app/voice-agent
CMD ["npm", "start"]
