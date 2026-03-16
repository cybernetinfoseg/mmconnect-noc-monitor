import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, CheckCircle, Clock, Search, Send, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

export default function Mensagens() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [currentUser, setCurrentUser] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['contact-messages'],
    queryFn: () => base44.entities.ContactMessage.list('-data_envio'),
    refetchInterval: 15000,
    enabled: currentUser?.role === 'admin',
  });

  const markAsReadMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ContactMessage.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-messages'] });
    },
  });

  const handleMarkAsRead = (message) => {
    markAsReadMutation.mutate({
      id: message.id,
      data: { lido: !message.lido },
    });
  };

  const handleMarkAsResponded = (message) => {
    markAsReadMutation.mutate({
      id: message.id,
      data: { respondido: !message.respondido, lido: true },
    });
  };

  const handleSendReply = async (msg) => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    await base44.integrations.Core.SendEmail({
      to: msg.from_email,
      subject: `Re: Sua mensagem - NOC Monitor`,
      body: replyText,
    });
    markAsReadMutation.mutate({ id: msg.id, data: { respondido: true, lido: true } });
    toast.success('Resposta enviada com sucesso!');
    setReplyingTo(null);
    setReplyText('');
    setSendingReply(false);
  };

  // Filter messages
  const filteredMessages = messages.filter(msg => {
    const matchSearch = 
      msg.from_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.from_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      msg.message?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchFilter = filterType === 'all' || msg.tipo === filterType;
    
    return matchSearch && matchFilter;
  });

  const stats = {
    total: messages.length,
    unread: messages.filter(m => !m.lido).length,
    pending: messages.filter(m => !m.respondido).length,
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-700 font-medium">Acesso restrito a administradores</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-xl">
            <Mail className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Mensagens de Contato</h1>
            <p className="text-sm text-slate-500">Gerencie mensagens de usuários em análise e solicitações gerais</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase">Total</p>
                  <p className="text-2xl font-bold text-slate-900 mt-2">{stats.total}</p>
                </div>
                <Mail className="h-6 w-6 text-slate-300" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-amber-700 uppercase">Não Lidas</p>
                  <p className="text-2xl font-bold text-amber-900 mt-2">{stats.unread}</p>
                </div>
                <Clock className="h-6 w-6 text-amber-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-blue-700 uppercase">Pendentes</p>
                  <p className="text-2xl font-bold text-blue-900 mt-2">{stats.pending}</p>
                </div>
                <CheckCircle className="h-6 w-6 text-blue-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                <Input
                  placeholder="Pesquisar por nome, email ou mensagem..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 border-slate-300"
                />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Tipos</SelectItem>
                  <SelectItem value="new_user_inquiry">Solicitação de Acesso</SelectItem>
                  <SelectItem value="support_request">Suporte</SelectItem>
                  <SelectItem value="general_contact">Contato Geral</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Messages List */}
        <div className="space-y-3">
          {isLoading ? (
            <Card className="bg-white/80">
              <CardContent className="pt-6 text-center text-slate-500">
                Carregando mensagens...
              </CardContent>
            </Card>
          ) : filteredMessages.length === 0 ? (
            <Card className="bg-white/80">
              <CardContent className="pt-6 text-center text-slate-500">
                Nenhuma mensagem encontrada
              </CardContent>
            </Card>
          ) : (
            filteredMessages.map((msg, idx) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className={cn(
                  "bg-white/80 backdrop-blur-sm border-slate-200/50 hover:shadow-lg transition-all cursor-pointer",
                  !msg.lido && "border-l-4 border-l-amber-500"
                )}>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      {/* Header */}
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{msg.from_name || msg.from_email}</p>
                          <p className="text-sm text-slate-500 truncate">{msg.from_email}</p>
                          {msg.from_phone && (
                            <p className="text-sm text-slate-500">{msg.from_phone}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={cn(
                            "text-xs",
                            msg.tipo === 'new_user_inquiry' ? 'bg-blue-100 text-blue-800' :
                            msg.tipo === 'support_request' ? 'bg-orange-100 text-orange-800' :
                            'bg-slate-100 text-slate-800'
                          )}>
                            {msg.tipo === 'new_user_inquiry' ? 'Solicitação de Acesso' :
                             msg.tipo === 'support_request' ? 'Suporte' :
                             'Contato Geral'}
                          </Badge>
                          {!msg.lido && (
                            <Badge className="bg-amber-100 text-amber-800 text-xs">Não Lida</Badge>
                          )}
                          {msg.respondido && (
                            <Badge className="bg-emerald-100 text-emerald-800 text-xs flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Respondida
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Message */}
                      <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-700 border border-slate-200">
                        <p className="whitespace-pre-wrap">{msg.message}</p>
                      </div>

                      {/* Footer */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-slate-200">
                        <p className="text-xs text-slate-500">
                          {new Date(msg.data_envio).toLocaleString('pt-BR')}
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleMarkAsRead(msg)}
                            className={cn(
                              "gap-2 text-xs",
                              msg.lido && "bg-emerald-50 border-emerald-200 text-emerald-700"
                            )}
                          >
                            {msg.lido ? '✓ Lida' : 'Marcar como Lida'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleMarkAsResponded(msg)}
                            className={cn(
                              "gap-2 text-xs",
                              msg.respondido && "bg-blue-50 border-blue-200 text-blue-700"
                            )}
                          >
                            {msg.respondido ? '✓ Respondida' : 'Marcar como Respondida'}
                          </Button>
                          <Button
                           variant="ghost"
                           size="sm"
                           onClick={() => {
                             setReplyingTo(replyingTo === msg.id ? null : msg.id);
                             setReplyText('');
                           }}
                           className="gap-2 text-xs text-blue-600 hover:bg-blue-50"
                          >
                           <Mail className="h-3 w-3" />
                           Responder
                          </Button>
                          </div>
                          </div>

                          {/* Inline Reply */}
                          {replyingTo === msg.id && (
                          <div className="pt-3 border-t border-slate-200 space-y-2">
                          <p className="text-xs font-medium text-slate-600">Responder para: <span className="text-blue-600">{msg.from_email}</span></p>
                          <Textarea
                            placeholder="Escreva sua resposta..."
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            rows={3}
                            className="text-sm"
                          />
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setReplyingTo(null); setReplyText(''); }}
                              className="gap-1 text-xs"
                            >
                              <X className="h-3 w-3" /> Cancelar
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSendReply(msg)}
                              disabled={sendingReply || !replyText.trim()}
                              className="gap-1 text-xs bg-blue-600 hover:bg-blue-700"
                            >
                              <Send className="h-3 w-3" />
                              {sendingReply ? 'Enviando...' : 'Enviar'}
                            </Button>
                          </div>
                          </div>
                          )}
                          </div>
                          </CardContent>
                          </Card>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}