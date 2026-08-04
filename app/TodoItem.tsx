import React from 'react';

interface TodoItemProps {
  id: string;
  text: string;
  completed: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export const TodoItem: React.FC<TodoItemProps> = ({
  id,
  text,
  completed,
  onToggle,
  onDelete,
}) => {
  return (
    <li className="todo-item">
      <input
        type="checkbox"
        className="todo-checkbox"
        checked={completed}
        onChange={() => onToggle(id)}
      />
      <span className={`todo-text ${completed ? 'completed' : ''}`}>
        {text}
      </span>
      <button onClick={() => onDelete(id)} style={{ marginLeft: 'auto', backgroundColor: '#dc3545' }}>
        删除
      </button>
    </li>
  );
};