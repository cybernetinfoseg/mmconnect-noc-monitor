import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Send, Loader } from 'lucide-react';
import { toast } from 'sonner';

export default function ContactAdminForm({ user }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!message.trim()) {
      toast.error('Escreva uma mensagem');
      return;
    }

    setLoading(true);
    try {
      await base44.functions.invoke('sendContactMessage', {
        from_email: user.email,
        from_name: `${user.nome || ''} ${user.sobrenome || ''}`.trim(),
        from_phone: user.telefone || '',
        message: message.trim(),
        tipo: 'new_user_inquiry',
      });

      toast.success('Mensagem registada! O admin irá vê-la no painel.');
      setMessage('');
    } catch (error) {
      console.error('Erro:', error);
      // Mesmo com erro de email, a mensagem pode ter sido guardada na BD
      const errMsg = error?.response?.data?.error || error.message || '';
      if (errMsg.includes('integration_credits') || errMsg.includes('limit')) {
        toast.warning('Mensagem registada, mas a notificação por email falhou. O admin verá no painel.');
        setMessage('');
      } else {
        toast.error('Erro ao enviar mensagem. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="message" className="text-slate-700 font-medium">
          Sua Mensagem
        </Label>
        <Textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Descreva sua solicitação, dúvidas ou informações adicionais para o administrador..."
          rows={5}
          className="border-slate-300 resize-none"
          disabled={loading}
        />
      </div>

      <Button
        type="submit"
        disabled={loading || !message.trim()}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium gap-2"
      >
        {loading ? (
          <>
            <Loader className="h-4 w-4 animate-spin" />
            Enviando...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Enviar Mensagem
          </>
        )}
      </Button>
    </form>
  );
}